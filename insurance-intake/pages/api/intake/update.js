const { getSessionFromReq } = require('../../../lib/auth');
const { updateIntakeAdminRecord, updateIntakeStoreRecord } = require('../../../lib/sheetsRepo');
const { INTAKE_ADMIN_EDITABLE, INTAKE_STORE_EDITABLE } = require('../../../lib/sheetSchema');

const ADMIN_KEY_SET = new Set(INTAKE_ADMIN_EDITABLE);
const STORE_KEY_SET = new Set(INTAKE_STORE_EDITABLE);

// 진행상황 저장. 두 종류의 항목을 하나의 요청으로 받아 각자 다른 스프레드시트에 씁니다.
//  - 보험사업부 진행상황(중복보장점검완료일·상담상태 등): 관리자만, 보험사업부 시트에 씁니다.
//  - 매장 입력 항목(고객 선물 지급일자·키트 불출인원·특이사항): 관리자·매니저 모두, 매장 시트에 씁니다.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { rowNumber, timestamp, name, updates } = req.body || {};
  if (!Number.isInteger(rowNumber) || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  const isAdmin = session.role === '관리자';

  const adminUpdates = {};
  const storeUpdates = {};
  for (const [key, value] of Object.entries(updates)) {
    if (isAdmin && ADMIN_KEY_SET.has(key)) adminUpdates[key] = value;
    else if (STORE_KEY_SET.has(key)) storeUpdates[key] = value;
  }

  if (Object.keys(adminUpdates).length === 0 && Object.keys(storeUpdates).length === 0) {
    return res.status(403).json({ error: '수정 권한이 없는 항목입니다.' });
  }
  if (Object.keys(storeUpdates).length > 0 && !timestamp) {
    return res.status(400).json({ error: '매장 입력 항목은 신청 일시 정보가 필요합니다.' });
  }

  try {
    if (Object.keys(adminUpdates).length > 0) {
      await updateIntakeAdminRecord({ rowNumber, updates: adminUpdates });
    }
    if (Object.keys(storeUpdates).length > 0) {
      await updateIntakeStoreRecord({ timestamp, name, updates: storeUpdates });
    }
    return res.status(200).json({ ok: true, updates: { ...adminUpdates, ...storeUpdates } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
  }
}
