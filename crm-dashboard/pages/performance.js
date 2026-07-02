import { useEffect, useState } from 'react';
import Link from 'next/link';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';
import { REF_SHEETS } from '../lib/sheetSchema';
import ChangePasswordModal from '../components/ChangePasswordModal';
import Announcement from '../components/Announcement';
import FaqWidget from '../components/FaqWidget';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  if (session.role === '관리자') {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }
  return {
    props: {
      role: session.role,
      name: session.name,
    },
  };
}

export default function PerformancePage({ role, name }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  async function fetchData(force = false) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/performance${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '불러오지 못했습니다.');
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const isEmpty = data && data.rows.length === 0;

  return (
    <div className="app-shell">
      <FaqWidget isAdmin={false} />
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">My Dealer</span>
          <span className="topbar-badge">{role}</span>
          <nav className="topbar-nav">
            <Link className="topbar-nav-link" href="/dashboard">회원관리</Link>
            {REF_SHEETS.filter((s) => !s.hiddenFromNav).map((s) => (
              <Link key={s.key} className="topbar-nav-link" href={`/sheet/${s.key}`}>{s.label}</Link>
            ))}
            <Link className="topbar-nav-link active" href="/performance">실적현황</Link>
          </nav>
        </div>
        <Announcement isAdmin={false} />
        <div className="topbar-right">
          <span className="topbar-user">{name}님</span>
          <button className="logout-btn" onClick={() => setChangingPassword(true)}>비밀번호 변경</button>
          <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
        </div>
      </div>

      <div className="page-content">
        <div className="filter-bar" style={{ marginBottom: 12 }}>
          <div className="filter-actions" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)' }}>
              컨택 실적현황
            </span>
            <button
              className="btn"
              onClick={() => fetchData(true)}
              disabled={loading}
              style={{ marginLeft: 'auto' }}
            >
              {loading ? '불러오는 중…' : '새로고침'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: 'var(--red)', padding: '16px 0', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {loading && !data && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>
            불러오는 중…
          </div>
        )}

        {data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {data.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isEmpty ? (
                  <tr className="empty-row">
                    <td colSpan={data.headers.length}>실적 데이터가 없습니다.</td>
                  </tr>
                ) : (
                  data.rows.map((row, ri) => (
                    <tr key={ri}>
                      {data.headers.map((_, ci) => (
                        <td key={ci}>{row[ci] ?? ''}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {changingPassword && (
        <ChangePasswordModal onClose={() => setChangingPassword(false)} />
      )}
    </div>
  );
}
