const { getSessionFromReq } = require('../../../lib/auth');
const { listAccountsForAdmin } = require('../../../lib/sheetsRepo');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  if (session.role !== '관리자') {
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  }

  try {
    const accounts = await listAccountsForAdmin();
    return res.status(200).json({ ok: true, accounts });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '계정 목록을 불러오지 못했습니다.' });
  }
}
