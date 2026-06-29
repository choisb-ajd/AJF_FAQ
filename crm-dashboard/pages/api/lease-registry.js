const { getSessionFromReq } = require('../../lib/auth');
const {
  readLeaseRegistry,
  addLeaseEntry,
  updateLeaseEntry,
  deleteLeaseEntry,
} = require('../../lib/sheetsRepo');

const REGISTRY_KEY = 'lease-pledge';

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const data = await readLeaseRegistry(REGISTRY_KEY);
      return res.status(200).json({ ok: true, entries: data.entries });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    const { action, id, company, businessNumber } = req.body || {};
    try {
      if (action === 'addEntry') {
        const result = await addLeaseEntry(REGISTRY_KEY, { company, businessNumber }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'updateEntry') {
        if (typeof id !== 'string' || !id) {
          return res.status(400).json({ error: '잘못된 요청입니다.' });
        }
        const result = await updateLeaseEntry(REGISTRY_KEY, id, { company, businessNumber }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'deleteEntry') {
        if (typeof id !== 'string' || !id) {
          return res.status(400).json({ error: '잘못된 요청입니다.' });
        }
        const result = await deleteLeaseEntry(REGISTRY_KEY, id, session);
        return res.status(200).json({ ok: true, ...result });
      }
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    } catch (e) {
      console.error(e);
      return res.status(400).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
