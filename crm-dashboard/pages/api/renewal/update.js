const { getSessionFromReq } = require('../../../lib/auth');
const { readRenewalRows, updateRenewalRecord } = require('../../../lib/sheetsRepo');
const { RENEWAL_MANAGER_EDITABLE, RENEWAL_ADMIN_ONLY_EDITABLE } = require('../../../lib/sheetSchema');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { rowNumber, updates } = req.body || {};
  if (!Number.isInteger(rowNumber) || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  const isAdmin = session.role === '관리자';
  const allowedKeys = new Set(isAdmin ? [...RENEWAL_MANAGER_EDITABLE, ...RENEWAL_ADMIN_ONLY_EDITABLE] : RENEWAL_MANAGER_EDITABLE);

  const { rows } = await readRenewalRows();
  const target = rows.find((r) => r.rowNumber === rowNumber);
  if (!target) {
    return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
  }
  if (!isAdmin && (target.values.manager || '').trim() !== session.name.trim()) {
    return res.status(403).json({ error: '본인 담당 건만 수정할 수 있습니다.' });
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.has(key)) cleaned[key] = value;
  }
  if (Object.keys(cleaned).length === 0) {
    return res.status(403).json({ error: '수정 권한이 없는 항목입니다.' });
  }

  try {
    const result = await updateRenewalRecord({ rowNumber, updates: cleaned });
    return res.status(200).json({ ...result, updates: cleaned });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
  }
}
