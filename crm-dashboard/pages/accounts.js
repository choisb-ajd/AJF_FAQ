import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';
import ChangePasswordModal from '../components/ChangePasswordModal';
import useEscapeKey from '../lib/useEscapeKey';
import { REF_SHEETS } from '../lib/sheetSchema';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  if (session.role !== '관리자') {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }
  return { props: { role: session.role, name: session.name } };
}

export default function AccountsPage({ role, name }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);

  async function fetchAccounts() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '계정 목록을 불러오지 못했습니다.');
      setAccounts(data.accounts);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">AJF 회원 관리 대시보드</span>
          <span className="topbar-badge">{role}</span>
          <nav className="topbar-nav">
            <Link className="topbar-nav-link" href="/dashboard">회원관리</Link>
            {REF_SHEETS.map((s) => (
              <Link key={s.key} className="topbar-nav-link" href={`/sheet/${s.key}`}>{s.label}</Link>
            ))}
            <Link className="topbar-nav-link active" href="/accounts">계정관리</Link>
          </nav>
        </div>
        <div className="topbar-right">
          <span className="topbar-user">{name}님</span>
          <button className="logout-btn" onClick={() => setChangingPassword(true)}>비밀번호 변경</button>
          <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
        </div>
      </div>

      <div className="page-body">
        <div className="page-heading">
          <div>
            <h1>계정관리</h1>
            <div className="count">등록된 계정 수: {accounts.length.toLocaleString()}개</div>
          </div>
          <button className="btn" onClick={fetchAccounts}>새로고침</button>
        </div>

        {loading ? (
          <div className="loading-state">불러오는 중...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>아이디</th>
                  <th>이름</th>
                  <th>권한</th>
                  <th>로그인 실패횟수</th>
                  <th>잠김여부</th>
                  <th>비고</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={7}>등록된 계정이 없습니다.</td>
                  </tr>
                ) : (
                  accounts.map((a) => (
                    <tr key={a.loginId}>
                      <td>{a.loginId}</td>
                      <td>{a.name || '-'}</td>
                      <td>{a.role || '-'}</td>
                      <td>{a.failedAttempts}</td>
                      <td>
                        {a.locked ? (
                          <span className="badge badge-lock">잠김</span>
                        ) : (
                          <span className="badge badge-unlock">정상</span>
                        )}
                      </td>
                      <td title={a.note}>{a.note || '-'}</td>
                      <td>
                        <button className="btn" onClick={() => setResetTarget(a)}>
                          비밀번호 초기화
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resetTarget && (
        <ResetPasswordModal
          account={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => {
            setResetTarget(null);
            fetchAccounts();
          }}
        />
      )}

      {changingPassword && (
        <ChangePasswordModal onClose={() => setChangingPassword(false)} />
      )}
    </div>
  );
}

function ResetPasswordModal({ account, onClose, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  useEscapeKey(onClose);

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 4) {
      setMessage({ type: 'err', text: '새 비밀번호는 4자 이상이어야 합니다.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'err', text: '새 비밀번호가 서로 일치하지 않습니다.' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/accounts/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: account.loginId, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'err', text: data.error || '초기화에 실패했습니다.' });
        setSaving(false);
        return;
      }
      onDone();
    } catch (e) {
      setMessage({ type: 'err', text: '네트워크 오류가 발생했습니다.' });
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>비밀번호 초기화</h2>
            <div className="sub">{account.name} ({account.loginId})</div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}

        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label>새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-field">
            <label>새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>취소</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '처리 중...' : '초기화하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
