const { getSessionFromReq } = require('../../../lib/auth');
const { adminResetPassword } = require('../../../lib/sheetsRepo');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  if (session.role !== '관리자') {
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  }

  const { loginId, newPassword } = req.body || {};
  if (!loginId || !newPassword) {
    return res.status(400).json({ error: '아이디와 새 비밀번호를 입력해주세요.' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });
  }

  try {
    await adminResetPassword(loginId, newPassword);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '비밀번호 초기화 중 오류가 발생했습니다.' });
  }
}
