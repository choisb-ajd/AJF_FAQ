const { getSessionFromReq } = require('../../../lib/auth');
const { updateMemberRecord, getAdminRows, logErrorToSheet } = require('../../../lib/sheetsRepo');
const { normalizePhone, appendContactHistoryNote, formatRegisteredAt } = require('../../../lib/sheetSchema');

// 딜러 상세 화면의 "컨택 히스토리" 패널에서 메모를 추가할 때 사용하는 전용 API입니다.
// 본문 수정(저장) 폼과는 별도로 동작해서, 메모 추가가 다른 항목 저장과 겹쳐도
// 서로의 변경 내용을 덮어쓰지 않습니다.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { phone, text } = req.body || {};
  const trimmed = (text || '').toString().trim();
  if (!phone || !trimmed) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }
  if (trimmed.length > 300) {
    return res.status(400).json({ error: '상담 내용은 300자 이내로 입력해주세요.' });
  }

  const isAdmin = session.role === '관리자';
  const { rows } = await getAdminRows();
  const target = rows.find((r) => normalizePhone(r.values.phone) === normalizePhone(phone));
  if (!target) {
    return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
  }
  if (!isAdmin && (target.values.manager || '').trim() !== session.name.trim()) {
    return res.status(403).json({ error: '본인 담당 회원만 메모를 추가할 수 있습니다.' });
  }

  const author = isAdmin ? '관리자' : session.name;
  const updates = {
    contactHistory: appendContactHistoryNote(target.values.contactHistory, { author, text: trimmed }),
    lastModifiedBy: author,
  };
  if (!target.values.firstContactDate) {
    updates.firstContactDate = formatRegisteredAt().slice(0, 10);
  }

  try {
    const result = await updateMemberRecord({ phone, updates });
    return res.status(200).json({ ...result, updates });
  } catch (e) {
    console.error(e);
    logErrorToSheet({ path: '/api/members/add-note', statusCode: 500, message: e.message, userName: session?.name });
    return res.status(500).json({ error: e.message || '메모 저장 중 오류가 발생했습니다.' });
  }
}
