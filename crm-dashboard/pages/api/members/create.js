const { getSessionFromReq } = require('../../../lib/auth');
const { createMemberRecord } = require('../../../lib/sheetsRepo');
const { MANAGER_EDITABLE, ADMIN_ONLY_EDITABLE, normalizePhone, formatRegisteredAt } = require('../../../lib/sheetSchema');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  const isAdmin = session.role === '관리자';

  const { name, phone, ...rest } = req.body || {};
  if (!name || !phone || !normalizePhone(phone)) {
    return res.status(400).json({ error: '이름과 연락처는 필수입니다.' });
  }

  // 매니저는 관리자 전용 항목 중에서도 다른 매니저에게 배분하거나(manager),
  // 본인은 볼 수 없는 관리자 특이사항(adminNote)은 입력할 수 없습니다.
  const allowedKeys = new Set(
    isAdmin
      ? [...MANAGER_EDITABLE, ...ADMIN_ONLY_EDITABLE]
      : [...MANAGER_EDITABLE, ...ADMIN_ONLY_EDITABLE].filter((k) => k !== 'manager' && k !== 'adminNote')
  );
  const fields = { name: name.trim(), phone: phone.trim() };
  for (const [key, value] of Object.entries(rest)) {
    if (allowedKeys.has(key) && value !== undefined) fields[key] = value;
  }
  // 매니저가 추가한 딜러는 본인 담당으로 자동 배정됩니다.
  fields.manager = isAdmin ? fields.manager : session.name;
  fields.lastModifiedBy = isAdmin ? '관리자' : session.name;
  fields.registeredAt = formatRegisteredAt();

  try {
    const result = await createMemberRecord(fields);
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '딜러 추가 중 오류가 발생했습니다.' });
  }
}
