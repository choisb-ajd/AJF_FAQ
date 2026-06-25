const { getSheetsClient } = require('./googleAuth');
const {
  buildColumnMap,
  rowArrayToValues,
  normalizePhone,
  columnIndexToLetter,
} = require('./sheetSchema');

const ADMIN_SPREADSHEET_ID = process.env.ADMIN_SPREADSHEET_ID;
const ACCOUNTS_SHEET_TITLE = '계정관리';
const MAX_FAILED_ATTEMPTS = 5;

// "계정관리" 탭의 컬럼 순서: 아이디 | 비밀번호 | 이름 | 권한 | 개인시트URL | 비고 | 실패횟수 | 잠김여부
const ACCOUNT_COLUMNS = {
  loginId: 'A',
  password: 'B',
  name: 'C',
  role: 'D',
  sheetUrl: 'E',
  note: 'F',
  failedAttempts: 'G',
  locked: 'H',
};

// 같은 서버 인스턴스에서 너무 자주 구글 API를 호출하지 않도록 짧게 캐시합니다.
const CACHE_TTL_MS = 20 * 1000;
const sheetDataCache = new Map(); // spreadsheetId -> { expires, data }
const dataSheetTitleCache = new Map(); // spreadsheetId -> title
let accountsCache = null; // { expires, accounts }

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

// 스프레드시트 안에서 "연락처"와 "담당매니저" 헤더가 모두 있는 탭을 데이터 탭으로 인식합니다.
// 관리자용/매니저용 모두 탭 이름이 달라도 동작하도록 만든 자동 탐색 로직입니다.
async function findDataSheetTitle(spreadsheetId) {
  if (dataSheetTitleCache.has(spreadsheetId)) {
    return dataSheetTitleCache.get(spreadsheetId);
  }
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);

  for (const title of titles) {
    const range = `${quoteSheetTitle(title)}!A1:Z1`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const headerRow = (res.data.values && res.data.values[0]) || [];
    const map = buildColumnMap(headerRow);
    if (map.phone !== undefined && map.manager !== undefined) {
      dataSheetTitleCache.set(spreadsheetId, title);
      return title;
    }
  }
  throw new Error(`스프레드시트(${spreadsheetId})에서 회원 데이터 탭을 찾지 못했습니다.`);
}

async function readSheetRows(spreadsheetId, { useCache = true } = {}) {
  const cached = sheetDataCache.get(spreadsheetId);
  if (useCache && cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const sheets = getSheetsClient();
  const sheetTitle = await findDataSheetTitle(spreadsheetId);
  const range = quoteSheetTitle(sheetTitle);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values || [];
  const headerRow = values[0] || [];
  const columnMap = buildColumnMap(headerRow);

  const rows = values.slice(1).map((rowArray, i) => ({
    rowNumber: i + 2, // 시트 상의 실제 행 번호 (1행은 헤더)
    values: rowArrayToValues(rowArray, columnMap),
  })).filter((r) => r.values.phone || r.values.name);

  const data = { sheetTitle, columnMap, rows };
  sheetDataCache.set(spreadsheetId, { expires: Date.now() + CACHE_TTL_MS, data });
  return data;
}

function invalidateCache(spreadsheetId) {
  sheetDataCache.delete(spreadsheetId);
}

async function getAdminRows({ useCache = true } = {}) {
  return readSheetRows(ADMIN_SPREADSHEET_ID, { useCache });
}

// "계정관리" 탭: 아이디 | 비밀번호 | 이름 | 권한 | 개인시트URL | 비고 | 실패횟수 | 잠김여부
async function getAccountsConfig({ useCache = true } = {}) {
  if (useCache && accountsCache && accountsCache.expires > Date.now()) {
    return accountsCache.accounts;
  }
  const sheets = getSheetsClient();
  const range = `${quoteSheetTitle(ACCOUNTS_SHEET_TITLE)}!A2:H`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SPREADSHEET_ID,
    range,
  });
  const accounts = (res.data.values || [])
    .map((r, i) => ({
      rowNumber: i + 2, // 시트 상의 실제 행 번호 (1행은 헤더)
      loginId: (r[0] || '').trim(),
      password: (r[1] || '').trim(),
      name: (r[2] || '').trim(),
      role: (r[3] || '').trim(), // '관리자' | '매니저'
      sheetUrl: (r[4] || '').trim(),
      note: (r[5] || '').trim(),
      failedAttempts: parseInt(r[6], 10) || 0,
      locked: (r[7] || '').trim().toUpperCase() === 'Y',
    }))
    .filter((a) => a.loginId);
  accountsCache = { expires: Date.now() + CACHE_TTL_MS, accounts };
  return accounts;
}

function invalidateAccountsCache() {
  accountsCache = null;
}

async function findAccountByLoginId(loginId, opts) {
  const accounts = await getAccountsConfig(opts);
  return accounts.find((a) => a.loginId === loginId) || null;
}

async function updateAccountFields(rowNumber, fieldsToUpdate) {
  const sheets = getSheetsClient();
  const data = [];
  for (const [key, value] of Object.entries(fieldsToUpdate)) {
    const col = ACCOUNT_COLUMNS[key];
    if (!col) continue;
    data.push({
      range: `${quoteSheetTitle(ACCOUNTS_SHEET_TITLE)}!${col}${rowNumber}`,
      values: [[value]],
    });
  }
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: ADMIN_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  invalidateAccountsCache();
}

// 로그인 비밀번호가 틀렸을 때 호출: 실패횟수를 올리고, 5회 이상이면 계정을 잠급니다.
async function recordFailedLogin(account) {
  const failedAttempts = account.failedAttempts + 1;
  const locked = failedAttempts >= MAX_FAILED_ATTEMPTS;
  await updateAccountFields(account.rowNumber, {
    failedAttempts,
    locked: locked ? 'Y' : '',
  });
  return { failedAttempts, locked };
}

// 로그인에 성공했을 때 호출: 실패횟수를 0으로 되돌립니다.
async function recordSuccessfulLogin(account) {
  if (account.failedAttempts === 0) return;
  await updateAccountFields(account.rowNumber, { failedAttempts: 0 });
}

// 본인이 비밀번호를 변경할 때 사용합니다.
async function changeOwnPassword(loginId, newPassword) {
  const account = await findAccountByLoginId(loginId, { useCache: false });
  if (!account) throw new Error('계정을 찾을 수 없습니다.');
  await updateAccountFields(account.rowNumber, { password: newPassword });
}

// 관리자가 매니저 계정의 비밀번호를 초기화할 때 사용합니다. 잠금/실패횟수도 함께 풀어줍니다.
async function adminResetPassword(loginId, newPassword) {
  const account = await findAccountByLoginId(loginId, { useCache: false });
  if (!account) throw new Error('계정을 찾을 수 없습니다.');
  await updateAccountFields(account.rowNumber, {
    password: newPassword,
    failedAttempts: 0,
    locked: '',
  });
}

// 관리자용 계정관리 화면에 보여줄 목록 (비밀번호 값은 제외)
async function listAccountsForAdmin() {
  const accounts = await getAccountsConfig({ useCache: false });
  return accounts.map(({ password, ...rest }) => rest);
}

function extractSpreadsheetId(url) {
  const m = (url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function getManagerSpreadsheetId(managerName) {
  const accounts = await getAccountsConfig();
  const account = accounts.find(
    (a) => a.role === '매니저' && a.name === managerName && a.sheetUrl
  );
  if (!account) return null;
  return extractSpreadsheetId(account.sheetUrl);
}

async function updateRowFields(spreadsheetId, sheetTitle, rowNumber, columnMap, fieldsToUpdate) {
  const sheets = getSheetsClient();
  const data = [];
  for (const [key, value] of Object.entries(fieldsToUpdate)) {
    if (columnMap[key] === undefined) continue; // 그 시트에 없는 컬럼이면 건너뜀
    const col = columnIndexToLetter(columnMap[key]);
    data.push({
      range: `${quoteSheetTitle(sheetTitle)}!${col}${rowNumber}`,
      values: [[value]],
    });
  }
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
  invalidateCache(spreadsheetId);
}

async function appendRowToSheet(spreadsheetId, sheetTitle, columnMap, fieldsObject) {
  const sheets = getSheetsClient();
  const width = Math.max(...Object.values(columnMap)) + 1;
  const rowArray = new Array(width).fill('');
  for (const [key, idx] of Object.entries(columnMap)) {
    if (fieldsObject[key] !== undefined) rowArray[idx] = fieldsObject[key];
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: quoteSheetTitle(sheetTitle),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowArray] },
  });
  invalidateCache(spreadsheetId);
}

// 신규 딜러 추가: 관리자(종합) 시트에 새 행을 추가하고, 담당매니저가 지정되어 있으면
// 그 매니저의 개별 시트에도 같은 내용을 추가합니다.
async function createMemberRecord(fields) {
  const admin = await getAdminRows({ useCache: false });
  const targetPhone = normalizePhone(fields.phone);
  const dup = admin.rows.find((r) => normalizePhone(r.values.phone) === targetPhone);
  if (dup) {
    throw new Error('이미 등록된 연락처입니다.');
  }

  await appendRowToSheet(ADMIN_SPREADSHEET_ID, admin.sheetTitle, admin.columnMap, fields);

  const managerName = fields.manager;
  if (!managerName) {
    return { ok: true, syncedToManagerSheet: false, warning: '담당매니저가 지정되어 있지 않아 개별 시트에는 반영하지 못했습니다.' };
  }

  const managerSpreadsheetId = await getManagerSpreadsheetId(managerName);
  if (!managerSpreadsheetId) {
    return {
      ok: true,
      syncedToManagerSheet: false,
      warning: `'${managerName}' 매니저의 개별 시트 주소가 계정관리 탭에 등록되어 있지 않아 개별 시트에는 반영하지 못했습니다.`,
    };
  }

  const mgr = await readSheetRows(managerSpreadsheetId, { useCache: false });
  await appendRowToSheet(managerSpreadsheetId, mgr.sheetTitle, mgr.columnMap, fields);

  return { ok: true, syncedToManagerSheet: true };
}

// 핵심 동기화 로직: 관리자(종합) 시트를 업데이트하고, 같은 연락처를 가진 행을
// 해당 담당매니저의 개별 시트에서도 찾아 업데이트(없으면 새로 추가)합니다.
async function updateMemberRecord({ phone, updates }) {
  const admin = await getAdminRows({ useCache: false });
  const targetPhone = normalizePhone(phone);
  const adminRow = admin.rows.find((r) => normalizePhone(r.values.phone) === targetPhone);
  if (!adminRow) {
    throw new Error('관리자 시트에서 해당 연락처의 회원을 찾지 못했습니다.');
  }

  await updateRowFields(
    ADMIN_SPREADSHEET_ID,
    admin.sheetTitle,
    adminRow.rowNumber,
    admin.columnMap,
    updates
  );

  const managerName = updates.manager || adminRow.values.manager;
  if (!managerName) {
    return { ok: true, syncedToManagerSheet: false, warning: '담당매니저가 지정되어 있지 않아 개별 시트에는 반영하지 못했습니다.' };
  }

  const managerSpreadsheetId = await getManagerSpreadsheetId(managerName);
  if (!managerSpreadsheetId) {
    return {
      ok: true,
      syncedToManagerSheet: false,
      warning: `'${managerName}' 매니저의 개별 시트 주소가 계정관리 탭에 등록되어 있지 않아 개별 시트에는 반영하지 못했습니다.`,
    };
  }

  const mgr = await readSheetRows(managerSpreadsheetId, { useCache: false });
  const mgrRow = mgr.rows.find((r) => normalizePhone(r.values.phone) === targetPhone);

  if (mgrRow) {
    await updateRowFields(
      managerSpreadsheetId,
      mgr.sheetTitle,
      mgrRow.rowNumber,
      mgr.columnMap,
      updates
    );
  } else {
    const fullRecord = { ...adminRow.values, ...updates };
    await appendRowToSheet(managerSpreadsheetId, mgr.sheetTitle, mgr.columnMap, fullRecord);
  }

  return { ok: true, syncedToManagerSheet: true };
}

module.exports = {
  ADMIN_SPREADSHEET_ID,
  MAX_FAILED_ATTEMPTS,
  getAdminRows,
  getAccountsConfig,
  findAccountByLoginId,
  getManagerSpreadsheetId,
  updateMemberRecord,
  createMemberRecord,
  recordFailedLogin,
  recordSuccessfulLogin,
  changeOwnPassword,
  adminResetPassword,
  listAccountsForAdmin,
};
