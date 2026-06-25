const {
  findAccountByLoginId,
  recordFailedLogin,
  recordSuccessfulLogin,
  MAX_FAILED_ATTEMPTS,
} = require('../../../lib/sheetsRepo');
const { signSession, setSessionCookie } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { loginId, password } = req.body || {};
  if (!loginId || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  try {
    const account = await findAccountByLoginId(loginId.trim(), { useCache: false });
    if (!account) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    if (account.locked) {
      return res.status(423).json({
        error: '비밀번호를 5회 이상 잘못 입력하여 계정이 잠겼습니다.\n관리자에게 비밀번호 초기화를 요청해주세요.',
      });
    }
    if (account.password !== password) {
      const { failedAttempts, locked } = await recordFailedLogin(account);
      if (locked) {
        return res.status(423).json({
          error: '비밀번호를 5회 이상 잘못 입력하여 계정이 잠겼습니다.\n관리자에게 비밀번호 초기화를 요청해주세요.',
        });
      }
      const remaining = MAX_FAILED_ATTEMPTS - failedAttempts;
      return res.status(401).json({
        error: `아이디 또는 비밀번호가 올바르지 않습니다.\n(${remaining}회 더 틀리면 계정이 잠깁니다)`,
      });
    }
    if (account.role !== '관리자' && account.role !== '매니저') {
      return res.status(403).json({ error: '계정의 권한 설정이 올바르지 않습니다. 관리자에게 문의해주세요.' });
    }

    await recordSuccessfulLogin(account);

    const token = signSession({
      loginId: account.loginId,
      name: account.name,
      role: account.role,
    });
    setSessionCookie(res, token);
    return res.status(200).json({ ok: true, name: account.name, role: account.role });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
}
