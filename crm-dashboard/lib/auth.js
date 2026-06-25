const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const COOKIE_NAME = 'ajf_session';
const SECRET = process.env.JWT_SECRET;

const SESSION_MAX_AGE_SEC = 60 * 60 * 24; // 로그인 시점으로부터 24시간

function signSession(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: SESSION_MAX_AGE_SEC });
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
      maxAge: SESSION_MAX_AGE_SEC,
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
