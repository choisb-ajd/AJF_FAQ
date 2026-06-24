const { getSheetsClient } = require('./googleAuth');
const {
  buildColumnMap,
  rowArrayToValues,
  normalizePhone,
  columnIndexToLetter,
} = require('./sheetSchema');

const ADMIN_SPREADSHEET_ID = process.env.ADMIN_SPREADSHEET_ID;
const ACCOUNTS_SHEET_TITLE = '계정관리';

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

// "계정관리" 탭: 아이디 | 비밀번호 | 이름 | 권한 | 개인시트URL | 비고
async function getAccountsConfig() {
  if (accountsCache && accountsCache.expires > Date.now()) {
    return accountsCache.accounts;
  }
  const sheets = getSheetsClient();
  const range = `${quoteSheetTitle(ACCOUNTS_SHEET_TITLE)}!A2:F`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SPREADSHEET_ID,
    range,
  });
  const accounts = (res.data.values || [])
    .filter((r) => r[0])
    .map((r) => ({
      loginId: (r[0] || '').trim(),
      password: (r[1] || '').trim(),
      name: (r[2] || '').trim(),
      role: (r[3] || '').trim(), // '관리자' | '매니저'
      sheetUrl: (r[4] || '').trim(),
      note: (r[5] || '').trim(),
    }));
  accountsCache = { expires: Date.now() + CACHE_TTL_MS, accounts };
  return accounts;
}

async function findAccountByLoginId(loginId) {
  const accounts = await getAccountsConfig();
  return accounts.find((a) => a.loginId === loginId) || null;
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
  getAdminRows,
  getAccountsConfig,
  findAccountByLoginId,
  getManagerSpreadsheetId,
  updateMemberRecord,
};
