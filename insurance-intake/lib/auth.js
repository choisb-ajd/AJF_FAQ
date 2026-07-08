const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const COOKIE_NAME = 'ajf_intake_session';
const SECRET = process.env.JWT_SECRET;

// 로그인 시점부터 당일 자정(00:00)까지 남은 초 수를 계산합니다.
function getSecsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(60, Math.floor((midnight - now) / 1000));
}

function signSession(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: getSecsUntilMidnight() });
}

function verifySession(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: getSecsUntilMidnight(),
    })
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );
}

function getSessionFromReq(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token);
}

module.exports = {
  COOKIE_NAME,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromReq,
};
