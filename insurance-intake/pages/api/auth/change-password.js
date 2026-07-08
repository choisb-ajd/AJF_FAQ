const { getSessionFromReq } = require('../../../lib/auth');
const { findAccountByLoginId, changeOwnPassword } = require('../../../lib/sheetsRepo');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });
  }

  try {
    const account = await findAccountByLoginId(session.loginId, { useCache: false });
    if (!account) {
      return res.status(401).json({ error: '계정을 찾을 수 없습니다.' });
    }
    if (account.password !== currentPassword) {
      return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }

    await changeOwnPassword(session.loginId, newPassword);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
}
