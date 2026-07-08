const { getSheetsClient } = require('./googleAuth');
const {
  letterToColumnIndex,
  INTAKE_ADMIN_FIELDS,
  INTAKE_STORE_SHEET,
} = require('./sheetSchema');

const INTAKE_ADMIN_SPREADSHEET_ID = process.env.INTAKE_ADMIN_SPREADSHEET_ID;
const INTAKE_STORE_SPREADSHEET_ID = process.env.INTAKE_STORE_SPREADSHEET_ID;
const INTAKE_ADMIN_SHEET_TITLE = '오프매장 전환DB_replit';

const ACCOUNTS_SHEET_TITLE = '계정관리';
const MAX_FAILED_ATTEMPTS = 5;
// 관리자 계정은 잠기면 아무도 풀어줄 수 없으므로(잠금 해제는 관리자만 가능),
// 잠그는 대신 이 비밀번호로 자동 초기화합니다.
const ADMIN_AUTO_RESET_PASSWORD = '@dkwjd12';

// "계정관리" 탭의 칼럼 순서: 아이디 | 비밀번호 | 이름 | 권한 | 비고 | 실패횟수 | 잠김여부
// (마이딜러와 달리 매니저별 개인 시트가 없어 "개인시트URL" 칼럼은 두지 않습니다)
const ACCOUNT_COLUMNS = {
  loginId: 'A',
  password: 'B',
  name: 'C',
  role: 'D',
  note: 'E',
  failedAttempts: 'F',
  locked: 'G',
};

const CACHE_TTL_MS = 2 * 60 * 1000; // 2분
let accountsCache = null; // { expires, accounts }
let intakeAdminCache = null; // { expires, rows }
let intakeStoreCache = null; // { expires, rows }

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

// ── 계정관리 ──────────────────────────────────────────────────────────────
async function getAccountsConfig({ useCache = true } = {}) {
  if (useCache && accountsCache && accountsCache.expires > Date.now()) {
    return accountsCache.accounts;
  }
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INTAKE_ADMIN_SPREADSHEET_ID,
    range: `${quoteSheetTitle(ACCOUNTS_SHEET_TITLE)}!A2:G`,
  });
  const accounts = (res.data.values || [])
    .map((r, i) => ({
      rowNumber: i + 2,
      loginId: (r[0] || '').trim(),
      password: (r[1] || '').trim(),
      name: (r[2] || '').trim(),
      role: (r[3] || '').trim(), // '관리자' | '매니저'
      note: (r[4] || '').trim(),
      failedAttempts: parseInt(r[5], 10) || 0,
      locked: (r[6] || '').trim().toUpperCase() === 'Y',
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
    spreadsheetId: INTAKE_ADMIN_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  invalidateAccountsCache();
}

// 로그인 비밀번호가 틀렸을 때 호출: 실패횟수를 올리고, 5회 이상이면 계정을 잠급니다.
// 관리자 계정은 잠그지 않고 비밀번호를 자동으로 초기화합니다.
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

async function recordSuccessfulLogin(account) {
  if (account.failedAttempts === 0 && !account.locked) return;
  await updateAccountFields(account.rowNumber, { failedAttempts: 0, locked: '' });
}

async function changeOwnPassword(loginId, newPassword) {
  const account = await findAccountByLoginId(loginId, { useCache: false });
  if (!account) throw new Error('계정을 찾을 수 없습니다.');
  await updateAccountFields(account.rowNumber, { password: newPassword });
}

async function adminResetPassword(loginId, newPassword) {
  const account = await findAccountByLoginId(loginId, { useCache: false });
  if (!account) throw new Error('계정을 찾을 수 없습니다.');
  await updateAccountFields(account.rowNumber, {
    password: newPassword,
    failedAttempts: 0,
    locked: '',
  });
}

async function listAccountsForAdmin() {
  const accounts = await getAccountsConfig({ useCache: false });
  return accounts.map(({ password, ...rest }) => rest);
}

// ── 오프라인 매장 보험접수 현황 ───────────────────────────────────────────────
// "오프매장 전환DB_replit" 탭: 고객 설문 페이지가 A~P열에 직접 기록하고, 보험사업부가 Q열부터
// 상담 진행상황을 기록합니다. 칼럼 위치가 고정돼 있어(INTAKE_ADMIN_FIELDS) 헤더 문구가 아니라
// 칼럼 위치 그대로 매핑합니다(예: "AJP 작성) 상담결과"처럼 헤더에 괄호가 섞여있는 등 문구가
// 일정하지 않은 칼럼이 있어 위치 매핑이 더 안전합니다).
function invalidateIntakeAdminCache() {
  intakeAdminCache = null;
}

async function readIntakeAdminRows({ useCache = true } = {}) {
  if (!INTAKE_ADMIN_SPREADSHEET_ID) {
    throw new Error('INTAKE_ADMIN_SPREADSHEET_ID 환경변수가 설정되지 않았습니다.');
  }
  if (useCache && intakeAdminCache && intakeAdminCache.expires > Date.now()) {
    return intakeAdminCache.rows;
  }

  const sheets = getSheetsClient();
  const lastCol = INTAKE_ADMIN_FIELDS[INTAKE_ADMIN_FIELDS.length - 1].col;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INTAKE_ADMIN_SPREADSHEET_ID,
    range: `${quoteSheetTitle(INTAKE_ADMIN_SHEET_TITLE)}!A2:${lastCol}`,
  });
  const values = res.data.values || [];

  const rows = values
    .map((rowArray, i) => {
      const v = {};
      for (const f of INTAKE_ADMIN_FIELDS) {
        v[f.key] = (rowArray[letterToColumnIndex(f.col)] || '').toString();
      }
      return { rowNumber: i + 2, values: v };
    })
    .filter((r) => r.values.name || r.values.phone);

  intakeAdminCache = { expires: Date.now() + CACHE_TTL_MS, rows };
  return rows;
}

// 보험사업부(관리자)가 진행상황 칼럼(Q열 이후)을 수정합니다. updates에 담긴 키는 호출 전
// (API 라우트에서) INTAKE_ADMIN_EDITABLE로 이미 걸러져 있다고 가정합니다.
async function updateIntakeAdminRecord({ rowNumber, updates }) {
  const colOf = Object.fromEntries(INTAKE_ADMIN_FIELDS.map((f) => [f.key, f.col]));
  const data = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = colOf[key];
    if (!col) continue;
    data.push({
      range: `${quoteSheetTitle(INTAKE_ADMIN_SHEET_TITLE)}!${col}${rowNumber}`,
      values: [[value == null ? '' : String(value)]],
    });
  }
  if (data.length === 0) return { ok: true };

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: INTAKE_ADMIN_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  invalidateIntakeAdminCache();
  return { ok: true };
}

// "신청인원 현황" 탭(매장 시트): B~L열은 보험사업부 시트를 IMPORTRANGE로 그대로 가져온 값이라
// 읽지 않고, timestamp(B열)만 보험사업부 시트 행과 짝을 맞추는 키로 읽습니다.
// M~O열(매장 직원 직접입력)만 다룹니다.
async function readIntakeStoreRows({ useCache = true } = {}) {
  if (!INTAKE_STORE_SPREADSHEET_ID) {
    throw new Error('INTAKE_STORE_SPREADSHEET_ID 환경변수가 설정되지 않았습니다.');
  }
  if (useCache && intakeStoreCache && intakeStoreCache.expires > Date.now()) {
    return intakeStoreCache.rows;
  }

  const sheets = getSheetsClient();
  const lastCol = INTAKE_STORE_SHEET.editable[INTAKE_STORE_SHEET.editable.length - 1].col;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INTAKE_STORE_SPREADSHEET_ID,
    range: `${quoteSheetTitle(INTAKE_STORE_SHEET.title)}!${INTAKE_STORE_SHEET.timestampCol}${INTAKE_STORE_SHEET.dataStartRow}:${lastCol}`,
  });
  const values = res.data.values || [];
  const baseIndex = letterToColumnIndex(INTAKE_STORE_SHEET.timestampCol);

  const rows = values.map((rowArray, i) => {
    const get = (col) => (rowArray[letterToColumnIndex(col) - baseIndex] || '').toString().trim();
    return {
      rowNumber: i + INTAKE_STORE_SHEET.dataStartRow,
      timestamp: get(INTAKE_STORE_SHEET.timestampCol),
      name: get(INTAKE_STORE_SHEET.nameCol),
    };
  });

  intakeStoreCache = { expires: Date.now() + CACHE_TTL_MS, rows };
  return rows;
}

// 매장 직원이 고객 선물 지급일자/키트 불출인원/특이사항을 입력합니다. timestamp(보험사업부 시트의
// "일시" 값 그대로)로 매장 시트에서 같은 신청 건의 행을 찾아 그 행에만 씁니다.
async function updateIntakeStoreRecord({ timestamp, name, updates }) {
  const storeRows = await readIntakeStoreRows({ useCache: false });
  const target = storeRows.find((r) => r.timestamp === timestamp && (!name || r.name === name));
  if (!target) {
    throw new Error('매장 시트에서 아직 이 신청 건을 찾지 못했습니다. 잠시 후 다시 시도해주세요.');
  }

  const colOf = Object.fromEntries(INTAKE_STORE_SHEET.editable.map((f) => [f.key, f.col]));
  const data = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = colOf[key];
    if (!col) continue;
    data.push({
      range: `${quoteSheetTitle(INTAKE_STORE_SHEET.title)}!${col}${target.rowNumber}`,
      values: [[value == null ? '' : String(value)]],
    });
  }
  if (data.length === 0) return { ok: true };

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: INTAKE_STORE_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  intakeStoreCache = null;
  // 보험사업부 시트 AG~AI열은 이 값을 IMPORTRANGE로 가져오므로 몇 초 내 자동 반영되지만,
  // 캐시된 관리자 목록에는 이전 값이 남아있을 수 있어 함께 무효화합니다.
  invalidateIntakeAdminCache();
  return { ok: true };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  getAccountsConfig,
  findAccountByLoginId,
  recordFailedLogin,
  recordSuccessfulLogin,
  changeOwnPassword,
  adminResetPassword,
  listAccountsForAdmin,
  readIntakeAdminRows,
  updateIntakeAdminRecord,
  updateIntakeStoreRecord,
};
