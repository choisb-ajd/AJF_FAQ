const { getSessionFromReq } = require('../../../lib/auth');
const { readRenewalRows, addRenewalCallNote } = require('../../../lib/sheetsRepo');

// 갱신배정 상세 화면의 "통화이력" 패널 전용 메모 추가 API입니다(회원관리의 add-note.js와 동일한 구조).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { rowNumber, text } = req.body || {};
  const trimmed = (text || '').toString().trim();
  if (!Number.isInteger(rowNumber) || !trimmed) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }
  if (trimmed.length > 300) {
    return res.status(400).json({ error: '통화 내용은 300자 이내로 입력해주세요.' });
  }

  const isAdmin = session.role === '관리자';
  const { rows } = await readRenewalRows();
  const target = rows.find((r) => r.rowNumber === rowNumber);
  if (!target) {
    return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
  }
  if (!isAdmin && (target.values.manager || '').trim() !== session.name.trim()) {
    return res.status(403).json({ error: '본인 담당 건만 통화이력을 추가할 수 있습니다.' });
  }

  const author = isAdmin ? '관리자' : session.name;

  try {
    const callHistory = await addRenewalCallNote(rowNumber, target.values.callHistory, trimmed, author);
    return res.status(200).json({ ok: true, callHistory });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
  }
}
