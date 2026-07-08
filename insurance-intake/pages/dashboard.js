import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';
import ChangePasswordModal from '../components/ChangePasswordModal';
import IntakeRegistry from '../components/IntakeRegistry';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: { role: session.role, name: session.name } };
}

export default function DashboardPage({ role, name }) {
  const router = useRouter();
  const isAdmin = role === '관리자';
  const [changingPassword, setChangingPassword] = useState(false);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-main">
          <div className="topbar-left">
            <span className="topbar-title">AJF 보험접수 현황</span>
            <span className="topbar-badge">{role}</span>
            <nav className="topbar-nav">
              <Link className="topbar-nav-link active" href="/dashboard">보험접수 현황</Link>
              {isAdmin && <Link className="topbar-nav-link" href="/accounts">계정관리</Link>}
            </nav>
          </div>
          <div className="topbar-right">
            <span className="topbar-user">{name}님</span>
            <button className="logout-btn" onClick={() => setChangingPassword(true)}>비밀번호 변경</button>
            <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="page-heading">
          <div>
            <h1>보험접수 현황</h1>
            <div className="count">
              {isAdmin
                ? '오프라인 매장 설문으로 접수된 건을 확인하고, 상담 진행상황을 기록합니다. 행을 클릭하면 상세·수정이 가능합니다.'
                : '매장에서 접수된 건을 확인하고, 선물 지급 여부 등 매장 입력 항목을 기록합니다.'}
            </div>
          </div>
        </div>

        <IntakeRegistry isAdmin={isAdmin} name={name} />
      </div>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
