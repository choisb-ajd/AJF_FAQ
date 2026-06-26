import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../../lib/auth';
import { REF_SHEETS } from '../../lib/sheetSchema';
import ChangePasswordModal from '../../components/ChangePasswordModal';

export async function getServerSideProps({ req, params }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const config = REF_SHEETS.find((s) => s.key === params.key);
  if (!config) {
    return { notFound: true };
  }
  const sheetUrl =
    session.role === '관리자' && process.env.ADMIN_SPREADSHEET_ID
      ? `https://docs.google.com/spreadsheets/d/${process.env.ADMIN_SPREADSHEET_ID}/edit#gid=${config.gid}`
      : null;
  return {
    props: {
      role: session.role,
      name: session.name,
      sheetKey: config.key,
      sheetLabel: config.label,
      sheetUrl,
    },
  };
}

export default function RefSheetPage({ role, name, sheetKey, sheetLabel, sheetUrl }) {
  const router = useRouter();
  const isAdmin = role === '관리자';
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [editingCell, setEditingCell] = useState(null); // { r, c }
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [cellError, setCellError] = useState('');

  async function fetchGrid() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/refsheet/${sheetKey}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '시트를 불러오지 못했습니다.');
      setGrid(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchGrid();
    setEditingCell(null);
    setCellError('');
  }, [sheetKey]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  function startEdit(r, c, currentValue) {
    if (!isAdmin) return;
    setCellError('');
    setEditingCell({ r, c });
    setEditValue(currentValue);
  }

  async function commitEdit() {
    if (!editingCell) return;
    const { r, c } = editingCell;
    const prevValue = grid.rows[r][c];
    setEditingCell(null);
    if (editValue === prevValue) return;

    setSavingCell(true);
    setGrid((g) => {
      const rows = g.rows.map((row) => row.slice());
      rows[r][c] = editValue;
      return { ...g, rows };
    });

    try {
      const res = await fetch(`/api/refsheet/${sheetKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex: r, colIndex: c, value: editValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
    } catch (e) {
      setGrid((g) => {
        const rows = g.rows.map((row) => row.slice());
        rows[r][c] = prevValue;
        return { ...g, rows };
      });
      setCellError(e.message);
    } finally {
      setSavingCell(false);
    }
  }

  function handleEditKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.target.blur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">AJF 회원 관리 대시보드</span>
          <span className="topbar-badge">{role}</span>
          <nav className="topbar-nav">
            <Link className="topbar-nav-link" href="/dashboard">회원관리</Link>
            {isAdmin && <Link className="topbar-nav-link" href="/accounts">계정관리</Link>}
            {REF_SHEETS.map((s) => (
              <Link
                key={s.key}
                className={`topbar-nav-link${s.key === sheetKey ? ' active' : ''}`}
                href={`/sheet/${s.key}`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          {sheetUrl && (
            <a className="logout-btn" href={sheetUrl} target="_blank" rel="noreferrer">
              구글 시트 원본 열기
            </a>
          )}
          <span className="topbar-user">{name}님</span>
          <button className="logout-btn" onClick={() => setChangingPassword(true)}>비밀번호 변경</button>
          <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
        </div>
      </div>

      <div className="page-body">
        <div className="page-heading">
          <div>
            <h1>{sheetLabel}</h1>
            <div className="count">
              {isAdmin
                ? '셀을 클릭하면 바로 수정할 수 있고, 저장하면 구글 시트에 즉시 반영됩니다.'
                : '보기 전용 화면입니다. 수정은 관리자만 할 수 있습니다.'}
            </div>
          </div>
          <button className="btn" onClick={fetchGrid}>새로고침</button>
        </div>

        {cellError && <div className="error-state ref-grid-error">{cellError}</div>}

        {loading ? (
          <div className="loading-state">불러오는 중...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : (
          <div className="table-wrap ref-grid-wrap">
            <table className="ref-grid">
              <thead>
                <tr>
                  <th className="ref-grid-corner"></th>
                  {grid.colLetters.map((letter, i) => (
                    <th key={i}>{letter}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={grid.colLetters.length + 1}>내용이 없습니다.</td>
                  </tr>
                ) : (
                  grid.rows.map((row, r) => (
                    <tr key={r}>
                      <td className="ref-grid-rownum">{r + 1}</td>
                      {row.map((cellValue, c) => {
                        const isEditing = !!editingCell && editingCell.r === r && editingCell.c === c;
                        return (
                          <td
                            key={c}
                            className={isAdmin ? 'ref-grid-cell editable' : 'ref-grid-cell'}
                            onClick={() => !isEditing && startEdit(r, c, cellValue)}
                          >
                            {isEditing ? (
                              <textarea
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={handleEditKeyDown}
                                disabled={savingCell}
                              />
                            ) : (
                              cellValue
                            )}
                          </td>
                        );
                      })}
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
