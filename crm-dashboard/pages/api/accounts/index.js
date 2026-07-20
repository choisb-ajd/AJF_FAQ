const { getSessionFromReq } = require('../../../lib/auth');
const { listAccountsForAdmin, createAccount } = require('../../../lib/sheetsRepo');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  if (session.role !== '관리자') {
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  }

  if (req.method === 'POST') {
    const { loginId, password, name, role, sheetUrl, note } = req.body || {};
    if (!loginId || !loginId.trim()) return res.status(400).json({ error: '아이디를 입력해주세요.' });
    if (!password || password.length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
    if (!name || !name.trim()) return res.status(400).json({ error: '이름을 입력해주세요.' });
    if (role !== '관리자' && role !== '매니저') return res.status(400).json({ error: '권한은 관리자 또는 매니저여야 합니다.' });
    try {
      await createAccount({ loginId, password, name, role, sheetUrl, note });
      return res.status(200).json({ ok: true });
    } catch (e) {
      if (e.message.includes('이미 사용 중인')) return res.status(409).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: '계정 생성 중 오류가 발생했습니다.' });
    }
  }

  try {
    const accounts = await listAccountsForAdmin();
    return res.status(200).json({ ok: true, accounts });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '계정 목록을 불러오지 못했습니다.' });
  }
}
