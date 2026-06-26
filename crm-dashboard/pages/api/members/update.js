const { getSessionFromReq } = require('../../../lib/auth');
const { updateMemberRecord, getAdminRows } = require('../../../lib/sheetsRepo');
const {
  MANAGER_EDITABLE,
  ADMIN_ONLY_EDITABLE,
  normalizePhone,
  formatRegisteredAt,
} = require('../../../lib/sheetSchema');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { phone, updates } = req.body || {};
  if (!phone || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  const isAdmin = session.role === '관리자';
  const allowedKeys = new Set(isAdmin ? [...MANAGER_EDITABLE, ...ADMIN_ONLY_EDITABLE] : MANAGER_EDITABLE);

  const { rows } = await getAdminRows();
  const target = rows.find((r) => normalizePhone(r.values.phone) === normalizePhone(phone));
  if (!target) {
    return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
  }
  if (!isAdmin && (target.values.manager || '').trim() !== session.name.trim()) {
    return res.status(403).json({ error: '본인 담당 회원만 수정할 수 있습니다.' });
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.has(key)) cleaned[key] = value;
  }
  if (Object.keys(cleaned).length === 0) {
    return res.status(403).json({ error: '수정 권한이 없는 항목입니다.' });
  }

  const author = isAdmin ? '관리자' : session.name;

  // 최초로 컨택 히스토리가 등록되면 최초컨택일자를 자동으로 채워줍니다.
  if (cleaned.contactHistory !== undefined && cleaned.contactHistory.trim() && !target.values.firstContactDate) {
    cleaned.firstContactDate = formatRegisteredAt().slice(0, 10);
  }

  cleaned.lastModifiedBy = author;

  try {
    const result = await updateMemberRecord({ phone, updates: cleaned });
    return res.status(200).json({ ...result, updates: cleaned });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
  }
}
