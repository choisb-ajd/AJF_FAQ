const { google } = require('googleapis');

let cachedClient = null;

// 구글 서비스 계정으로 인증된 Sheets API 클라이언트를 반환합니다.
// 서버가 살아있는 동안(같은 람다 인스턴스) 한 번만 만들고 재사용합니다.
function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const key = rawKey.replace(/\\n/g, '\n');

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
