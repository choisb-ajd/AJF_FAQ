import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';

const REMEMBER_ID_KEY = 'ajf_intake_remember_login_id';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (session) {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }
  return { props: {} };
}

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [rememberId, setRememberId] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 이 기기에 저장된 아이디가 있으면 입력칸에 미리 채워줍니다 (비밀번호는 절대 저장하지 않습니다).
  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_ID_KEY);
    if (saved) {
      setLoginId(saved);
      setRememberId(true);
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        setLoading(false);
        return;
      }
      if (rememberId) {
        window.localStorage.setItem(REMEMBER_ID_KEY, loginId);
      } else {
        window.localStorage.removeItem(REMEMBER_ID_KEY);
      }
      router.push('/dashboard');
    } catch (e) {
      setError('네트워크 오류가 발생했습니다.');
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">AJF INSURANCE INTAKE</div>
        <div className="login-title">보험접수 현황</div>
        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="loginId">아이디</label>
            <input
              id="loginId"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="아이디를 입력하세요"
              autoFocus
            />
          </div>
          <div className="login-field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
            />
          </div>
          <div className="login-remember">
            <label htmlFor="rememberId">
              <input
                id="rememberId"
                type="checkbox"
                checked={rememberId}
                onChange={(e) => setRememberId(e.target.checked)}
              />
              아이디 저장
            </label>
          </div>
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}
