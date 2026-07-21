const { getSessionFromReq } = require('../../../lib/auth');
const { importManagerNotesToCallHistory } = require('../../../lib/sheetsRepo');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session || session.role !== '관리자') {
    return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });
  }

  try {
    const result = await importManagerNotesToCallHistory();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '가져오기 중 오류가 발생했습니다.' });
  }
}
