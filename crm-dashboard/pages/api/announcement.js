const { getSessionFromReq } = require('../../lib/auth');
const { readAnnouncement, saveAnnouncement } = require('../../lib/sheetsRepo');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const text = await readAnnouncement();
      return res.status(200).json({ ok: true, text });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const text = await saveAnnouncement((req.body || {}).text, session);
      return res.status(200).json({ ok: true, text });
    } catch (e) {
      console.error(e);
      return res.status(400).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
