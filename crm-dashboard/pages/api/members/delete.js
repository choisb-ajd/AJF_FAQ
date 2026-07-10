const { getSessionFromReq } = require('../../../lib/auth');
const { deleteMemberRecord, getAdminRows, logErrorToSheet } = require('../../../lib/sheetsRepo');
const { normalizePhone } = require('../../../lib/sheetSchema');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { phone } = req.body || {};
  if (!phone) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  // 매니저는 본인 담당 회원만 삭제 가능
  if (session.role !== '관리자') {
    const { rows } = await getAdminRows();
    const target = rows.find((r) => normalizePhone(r.values.phone) === normalizePhone(phone));
    if (!target) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
    if ((target.values.manager || '').trim() !== session.name.trim()) {
      return res.status(403).json({ error: '본인 담당 회원만 삭제할 수 있습니다.' });
    }
  }

  try {
    const result = await deleteMemberRecord({ phone });
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    logErrorToSheet({ path: '/api/members/delete', statusCode: 500, message: e.message, userName: session?.name });
    return res.status(500).json({ error: e.message || '삭제 중 오류가 발생했습니다.' });
  }
}
