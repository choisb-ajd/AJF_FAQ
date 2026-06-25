const { getSessionFromReq } = require('../../../lib/auth');
const { createMemberRecord } = require('../../../lib/sheetsRepo');
const { MANAGER_EDITABLE, ADMIN_ONLY_EDITABLE, normalizePhone } = require('../../../lib/sheetSchema');

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
    return res.status(403).json({ error: '관리자만 딜러를 추가할 수 있습니다.' });
  }

  const { name, phone, ...rest } = req.body || {};
  if (!name || !phone || !normalizePhone(phone)) {
    return res.status(400).json({ error: '이름과 연락처는 필수입니다.' });
  }

  const allowedKeys = new Set([...MANAGER_EDITABLE, ...ADMIN_ONLY_EDITABLE]);
  const fields = { name: name.trim(), phone: phone.trim() };
  for (const [key, value] of Object.entries(rest)) {
    if (allowedKeys.has(key) && value !== undefined) fields[key] = value;
  }

  try {
    const result = await createMemberRecord(fields);
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '딜러 추가 중 오류가 발생했습니다.' });
  }
}
