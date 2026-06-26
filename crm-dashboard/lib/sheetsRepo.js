const { getSheetsClient } = require('./googleAuth');
const {
  buildColumnMap,
  rowArrayToValues,
  normalizePhone,
  columnIndexToLetter,
  letterToColumnIndex,
  MANAGER_EDITABLE,
  REF_SHEETS,
} = require('./sheetSchema');

const ADMIN_SPREADSHEET_ID = process.env.ADMIN_SPREADSHEET_ID;
const ACCOUNTS_SHEET_TITLE = '계정관리';
const MAX_FAILED_ATTEMPTS = 5;
// 관리자 계정은 잠기면 아무도 풀어줄 수 없으므로(잠금 해제는 관리자만 가능),
// 잠그는 대신 이 비밀번호로 자동 초기화합니다.
const ADMIN_AUTO_RESET_PASSWORD = '@dkwjd12';

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
const refSheetCache = new Map(); // refSheet key -> { expires, data }
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

// 시트를 그대로 웹페이지에 심는 화면(REF_SHEETS)용: 의미별 컬럼 매핑 없이 셀 위치 그대로 읽고/씁니다.
function getRefSheetConfig(key) {
  const config = REF_SHEETS.find((s) => s.key === key);
  if (!config) throw new Error(`알 수 없는 시트입니다: ${key}`);
  return config;
}

function refSheetRange(config) {
  const base = quoteSheetTitle(config.title);
  if (config.colStart && config.colEnd) {
    return `${base}!${config.colStart}:${config.colEnd}`;
  }
  return base;
}

async function readRefSheetGrid(key, { useCache = true } = {}) {
  const config = getRefSheetConfig(key);
  const cached = refSheetCache.get(key);
  if (useCache && cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SPREADSHEET_ID,
    range: refSheetRange(config),
  });
  const values = res.data.values || [];
  const width = Math.max(1, values.reduce((max, row) => Math.max(max, row.length), 0));
  const rows = values.map((row) => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });
  const startColIndex = config.colStart ? letterToColumnIndex(config.colStart) : 0;
  const colLetters = Array.from({ length: width }, (_, i) => columnIndexToLetter(startColIndex + i));

  const data = { key, title: config.title, label: config.label, gid: config.gid, colLetters, rows };
  refSheetCache.set(key, { expires: Date.now() + CACHE_TTL_MS, data });
  return data;
}

function invalidateRefSheetCache(key) {
  refSheetCache.delete(key);
}

async function updateRefSheetCell(key, rowIndex, colIndex, value) {
  const config = getRefSheetConfig(key);
  const startColIndex = config.colStart ? letterToColumnIndex(config.colStart) : 0;
  const colLetter = columnIndexToLetter(startColIndex + colIndex);
  const rowNumber = rowIndex + 1; // 그리드 0번째 행 = 시트 1행
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: ADMIN_SPREADSHEET_ID,
    range: `${quoteSheetTitle(config.title)}!${colLetter}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
  invalidateRefSheetCache(key);
}

// 매니저 개별 시트 ↔ 관리자(종합) 시트 역방향 동기화를 너무 자주 돌리지 않도록
// (여러 사용자가 동시에 화면을 보고 있어도) 20초에 한 번만 실행되게 막습니다.
const MANAGER_SYNC_INTERVAL_MS = CACHE_TTL_MS;
let lastManagerSyncAt = 0;
let managerSyncInFlight = null;

function ensureManagerSync() {
  if (managerSyncInFlight) return managerSyncInFlight;
  if (Date.now() - lastManagerSyncAt < MANAGER_SYNC_INTERVAL_MS) return Promise.resolve();

  managerSyncInFlight = syncManagerSheetsIntoAdmin()
    .catch((e) => console.error('매니저 시트 → 관리자 시트 역방향 동기화 실패:', e))
    .finally(() => {
      lastManagerSyncAt = Date.now();
      managerSyncInFlight = null;
    });
  return managerSyncInFlight;
}

async function getAdminRows({ useCache = true } = {}) {
  await ensureManagerSync();
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
// 단, 관리자 계정은 잠그지 않고 비밀번호를 자동으로 초기화합니다(관리자가 잠기면
// 아무도 풀어줄 수 없기 때문).
async function recordFailedLogin(account) {
  const failedAttempts = account.failedAttempts + 1;

  if (account.role === '관리자') {
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await updateAccountFields(account.rowNumber, {
        password: ADMIN_AUTO_RESET_PASSWORD,
        failedAttempts: 0,
        locked: '',
      });
      return { failedAttempts, locked: false, passwordReset: true };
    }
    await updateAccountFields(account.rowNumber, { failedAttempts });
    return { failedAttempts, locked: false, passwordReset: false };
  }

  const locked = failedAttempts >= MAX_FAILED_ATTEMPTS;
  await updateAccountFields(account.rowNumber, {
    failedAttempts,
    locked: locked ? 'Y' : '',
  });
  return { failedAttempts, locked, passwordReset: false };
}

// 로그인에 성공했을 때 호출: 실패횟수를 0으로 되돌립니다.
// (예전에 잠겼던 관리자 계정이 남아있을 수 있어 잠김 표시도 함께 정리합니다.)
async function recordSuccessfulLogin(account) {
  if (account.failedAttempts === 0 && !account.locked) return;
  await updateAccountFields(account.rowNumber, { failedAttempts: 0, locked: '' });
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

// API를 호출하지 않고 batchUpdate용 data 배열만 만듭니다.
// (여러 행의 변경을 한 번에 모아서 batchUpdate 한 번으로 보내기 위해 분리해두었습니다.)
function buildRowUpdateData(sheetTitle, rowNumber, columnMap, fieldsToUpdate) {
  const data = [];
  for (const [key, value] of Object.entries(fieldsToUpdate)) {
    if (columnMap[key] === undefined) continue; // 그 시트에 없는 컬럼이면 건너뜀
    const col = columnIndexToLetter(columnMap[key]);
    data.push({
      range: `${quoteSheetTitle(sheetTitle)}!${col}${rowNumber}`,
      values: [[value]],
    });
  }
  return data;
}

async function updateRowFields(spreadsheetId, sheetTitle, rowNumber, columnMap, fieldsToUpdate) {
  const data = buildRowUpdateData(sheetTitle, rowNumber, columnMap, fieldsToUpdate);
  if (data.length === 0) return;
  const sheets = getSheetsClient();
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

// 매니저 개별 시트 → 관리자(종합) 시트 역방향 동기화.
// 매니저가 앱을 거치지 않고 자신의 구글 시트에 직접 입력한 내용(컨택여부, 컨택 히스토리 등
// 매니저가 수정할 수 있는 필드)을 관리자 시트로 가져옵니다. 같은 연락처 행이 두 시트에서
// 값이 다르면 매니저의 개별 시트 값을 우선합니다(매니저가 본인 시트에 직접 적은 내용이므로).
// 관리자 시트에 없는 연락처(매니저가 자기 시트에 직접 추가한 신규 딜러)는 관리자 시트에도 추가합니다.
async function syncManagerSheetsIntoAdmin() {
  const admin = await readSheetRows(ADMIN_SPREADSHEET_ID, { useCache: false });
  const accounts = await getAccountsConfig({ useCache: false });
  const managers = accounts.filter((a) => a.role === '매니저' && a.sheetUrl);

  const adminByPhone = new Map();
  for (const row of admin.rows) {
    const phone = normalizePhone(row.values.phone);
    if (phone) adminByPhone.set(phone, row);
  }
  const seenPhones = new Set(adminByPhone.keys());

  const updateData = [];
  const newRows = [];

  for (const manager of managers) {
    const spreadsheetId = extractSpreadsheetId(manager.sheetUrl);
    if (!spreadsheetId) continue;

    let mgrSheet;
    try {
      mgrSheet = await readSheetRows(spreadsheetId, { useCache: false });
    } catch (e) {
      console.error(`매니저 '${manager.name}' 개별 시트를 읽지 못했습니다:`, e.message);
      continue;
    }

    for (const mgrRow of mgrSheet.rows) {
      const phone = normalizePhone(mgrRow.values.phone);
      if (!phone) continue;

      const adminRow = adminByPhone.get(phone);
      if (adminRow) {
        const diff = {};
        for (const key of MANAGER_EDITABLE) {
          if (mgrSheet.columnMap[key] === undefined) continue;
          const mgrValue = (mgrRow.values[key] || '').toString();
          const adminValue = (adminRow.values[key] || '').toString();
          if (mgrValue !== adminValue) diff[key] = mgrValue;
        }
        if (Object.keys(diff).length > 0) {
          updateData.push(
            ...buildRowUpdateData(admin.sheetTitle, adminRow.rowNumber, admin.columnMap, diff)
          );
          Object.assign(adminRow.values, diff);
        }
      } else if (!seenPhones.has(phone)) {
        seenPhones.add(phone);
        const fields = { ...mgrRow.values };
        if (!fields.manager) fields.manager = manager.name;
        newRows.push(fields);
      }
    }
  }

  const sheets = getSheetsClient();

  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ADMIN_SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updateData },
    });
  }

  if (newRows.length > 0) {
    const width = Math.max(...Object.values(admin.columnMap)) + 1;
    const rowArrays = newRows.map((fields) => {
      const rowArray = new Array(width).fill('');
      for (const [key, idx] of Object.entries(admin.columnMap)) {
        if (fields[key] !== undefined) rowArray[idx] = fields[key];
      }
      return rowArray;
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: ADMIN_SPREADSHEET_ID,
      range: quoteSheetTitle(admin.sheetTitle),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rowArrays },
    });
  }

  if (updateData.length > 0 || newRows.length > 0) {
    invalidateCache(ADMIN_SPREADSHEET_ID);
  }

  return { updatedFields: updateData.length, appendedRows: newRows.length };
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
  readRefSheetGrid,
  updateRefSheetCell,
};
