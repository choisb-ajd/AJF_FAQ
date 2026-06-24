const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const COOKIE_NAME = 'ajf_session';
const SECRET = process.env.JWT_SECRET;

function signSession(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
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
      maxAge: 60 * 60 * 12,
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
