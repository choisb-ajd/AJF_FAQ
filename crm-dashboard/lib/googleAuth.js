const { google } = require('googleapis');

let cachedClient = null;

// Vercel 환경변수 입력 시 자주 생기는 형식 손상(앞뒤 따옴표, 이스케이프된 개행 등)을 정리합니다.
// 그대로 두면 OpenSSL이 PEM으로 못 읽어서 "DECODER routines::unsupported" 에러가 납니다.
function normalizePrivateKey(rawKey) {
  let key = (rawKey || '').trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/\\n/g, '\n');
}

// 구글 서비스 계정으로 인증된 Sheets API 클라이언트를 반환합니다.
// 서버가 살아있는 동안(같은 람다 인스턴스) 한 번만 만들고 재사용합니다.
function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (!email || !key) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY 환경변수가 설정되지 않았습니다.'
    );
  }

  const auth = new google.auth.JWT(email, null, key, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);

  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

module.exports = { getSheetsClient };
