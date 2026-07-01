const { getSessionFromReq } = require('../../../lib/auth');
const { updateMemberRecord } = require('../../../lib/sheetsRepo');

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
    return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });
  }

  const { phones, manager } = req.body || {};
  if (!Array.isArray(phones) || phones.length === 0 || !manager || typeof manager !== 'string') {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  const updated = [];
  const failed = [];

  for (const phone of phones) {
    try {
      await updateMemberRecord({
        phone,
        updates: { manager, lastModifiedBy: '관리자' },
      });
      updated.push(phone);
    } catch (e) {
      console.error(`bulk-manager failed for phone ${phone}:`, e.message);
      failed.push(phone);
    }
  }

  return res.status(200).json({ ok: true, updated, failed });
}
