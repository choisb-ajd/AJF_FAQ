import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';
import {
  DISPLAY_COLUMNS,
  MANAGER_EDITABLE,
  ADMIN_ONLY_EDITABLE,
  MODAL_COMMON_COLLAPSIBLE,
  MODAL_ADMIN_COLLAPSIBLE_EXTRA,
  REF_SHEETS,
  formatDateDisplay,
  parseContactHistory,
} from '../lib/sheetSchema';
import ChangePasswordModal from '../components/ChangePasswordModal';
import useEscapeKey from '../lib/useEscapeKey';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return {
    props: {
      role: session.role,
      name: session.name,
      adminSheetUrl:
        session.role === '관리자' && process.env.ADMIN_SPREADSHEET_ID
          ? `https://docs.google.com/spreadsheets/d/${process.env.ADMIN_SPREADSHEET_ID}/edit`
          : null,
    },
  };
}

const FIELD_META = {
  name: { label: '이름', type: 'text', required: true },
  phone: { label: '연락처', type: 'text', placeholder: '예: 010-1234-5678', required: true },
  contacted: { label: '컨택여부', type: 'select', options: ['', 'Y', 'N'] },
  firstContactDate: { label: '최초컨택일자', type: 'date' },
  reContactDate: { label: '재컨택일자', type: 'date' },
  smsSent: { label: '문자여부', type: 'select', options: ['', 'Y', 'N'] },
  contactSentiment: { label: '컨택 호의도', type: 'select', options: ['', 'A', 'B', 'C'] },
  contactHistory: { label: '컨택 히스토리', type: 'textarea' },
  preRegistered: { label: '사전예약여부', type: 'select', options: ['', 'Y', 'N'] },
  group: {
    label: '그룹',
    type: 'select',
    options: [
      { value: '', label: '(미선택)' },
      { value: 'G1', label: 'G1(수입)' },
      { value: 'G2', label: 'G2(국산)' },
      { value: 'G3', label: 'G3(중고차)' },
      { value: 'G4', label: 'G4(보험설계)' },
      { value: 'G5', label: 'G5(에이전시)' },
    ],
  },
  brand: { label: '브랜드', type: 'text' },
  wideInsta: { label: '광역/인스타', type: 'text' },
  region: { label: '권역', type: 'text' },
  branch: { label: '지점/대리점 명', type: 'text' },
  manager: { label: '담당매니저', type: 'text' },
  assignedDate: { label: '배분일자', type: 'date' },
  priorityDealer: { label: '우선컨택 딜러여부', type: 'select', options: ['', 'Y', 'N'] },
  highEfficiency: { label: '고효율딜러여부', type: 'select', options: ['', 'Y', 'N'] },
  highEfficiencyScore: { label: '고효율딜러수치', type: 'text' },
  appJoinDate: { label: 'App가입일자', type: 'text' },
  totalContracts: { label: '누적 계약체결건수', type: 'text' },
  last60dContracts: { label: '직전 60일 계약체결건수', type: 'text' },
  last1yTop10: { label: '직전 1년 본인 10% 횟수', type: 'text' },
  adminNote: { label: '관리자 특이사항', type: 'textarea' },
};

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

// 현재 페이지를 기준으로 "1 2 3 4 5 ... 85" 같은 페이지 번호 목록을 만듭니다.
// 페이지 수가 적으면 전부 보여주고, 많으면 앞/뒤 또는 현재 위치 주변만 보여주고 가운데는 '...'로 줄입니다.
function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

function Badge({ value }) {
  if (!value) return <span style={{ color: '#C2C7CC' }}>-</span>;
  const v = value.trim().toUpperCase();
  if (v === 'Y') return <span className="badge badge-y">Y</span>;
  if (v === 'N') return <span className="badge badge-n">N</span>;
  if (v === 'A') return <span className="badge badge-a">A</span>;
  if (v === 'B') return <span className="badge badge-b">B</span>;
  if (v === 'C') return <span className="badge badge-c">C</span>;
  return <span>{value}</span>;
}

function csvEscape(v) {
  const s = v === undefined || v === null ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const NUMERIC_SORT_KEYS = ['totalContracts', 'last60dContracts', 'last1yTop10', 'highEfficiencyScore'];
const DATE_SORT_KEYS = ['registeredAt', 'firstContactDate', 'reContactDate', 'assignedDate', 'appJoinDate'];
// 표/모달에서 날짜 표기를 "YYYY-MM-DD" 한 형식으로 통일해서 보여줄 칼럼들
const DATE_DISPLAY_KEYS = ['firstContactDate', 'reContactDate', 'assignedDate', 'appJoinDate'];

// 칼럼 종류에 따라 숫자/날짜/문자열 중 알맞은 방식으로 두 값을 비교합니다.
// 값이 없는 경우(특히 날짜)는 가장 오래된/작은 값으로 취급해 정렬 시 뒤로 밀립니다.
function compareRows(a, b, key) {
  const av = a[key] || '';
  const bv = b[key] || '';
  if (NUMERIC_SORT_KEYS.includes(key)) {
    return (Number(av) || 0) - (Number(bv) || 0);
  }
  if (DATE_SORT_KEYS.includes(key)) {
    return (Date.parse(av) || 0) - (Date.parse(bv) || 0);
  }
  return av.toString().localeCompare(bv.toString(), 'ko');
}

// 칼럼별 기본 너비(px). 글자수를 고려해 라벨/내용이 잘리지 않을 정도로 잡아둔 값이며,
// 칼럼 머리글의 손잡이를 드래그하면 사용자가 직접 더 늘리거나 줄일 수 있습니다.
const DEFAULT_COL_WIDTHS = {
  name: 100,
  phone: 130,
  manager: 110,
  group: 90,
  brand: 90,
  branch: 150,
  contacted: 90,
  firstContactDate: 120,
  reContactDate: 120,
  smsSent: 90,
  contactSentiment: 90,
  contactHistory: 220,
  appJoinDate: 120,
  totalContracts: 90,
  last60dContracts: 90,
  registeredAt: 150,
  adminNote: 200,
  lastModifiedBy: 90,
};
const DEFAULT_COL_WIDTH = 110;
const MIN_COL_WIDTH = 50;
const ACTION_COL_WIDTH = 70;

export default function DashboardPage({ role, name, adminSheetUrl }) {
  const router = useRouter();
  const isAdmin = role === '관리자';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [contactedFilter, setContactedFilter] = useState('');
  const [preRegFilter, setPreRegFilter] = useState('');
  const [appJoinFilter, setAppJoinFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [gotoInput, setGotoInput] = useState('');

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [addingDealer, setAddingDealer] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addMsg, setAddMsg] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [managerOptions, setManagerOptions] = useState(null);
  const [sortKey, setSortKey] = useState('registeredAt');
  const [sortDir, setSortDir] = useState('desc');
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);

  // silent=true면 화면에 "불러오는 중..." 스피너를 띄우지 않고 조용히 최신 데이터로 교체합니다.
  // 구글 시트에서 직접 수정한 내용도 이 폴링을 통해 자동으로 화면에 반영됩니다.
  async function fetchRows({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/members');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '데이터를 불러오지 못했습니다.');
      setRows(data.rows);
      setLastSynced(new Date());
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
  }, []);

  // 담당매니저 드롭박스에 쓸 매니저 이름 목록을 계정관리 탭 데이터에서 가져옵니다. (관리자만)
  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.accounts)) return;
        const names = data.accounts
          .filter((a) => a.role === '매니저')
          .map((a) => a.name)
          .filter(Boolean)
          .sort();
        setManagerOptions(names);
      })
      .catch(() => {});
  }, [isAdmin]);

  // 편집창이 열려있지 않을 때만 일정 주기로 조용히 새 데이터를 가져옵니다.
  // (편집 중에 화면이 바뀌면 입력 중인 내용을 잃어버릴 수 있어 그 동안은 잠시 멈춥니다)
  useEffect(() => {
    if (editing || addingDealer) return;
    const interval = setInterval(() => {
      fetchRows({ silent: true });
    }, 20000);
    return () => clearInterval(interval);
  }, [editing, addingDealer]);

  const managers = useMemo(() => {
    const set = new Set(rows.map((r) => r.manager).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.name || ''} ${r.phone || ''} ${r.branch || ''} ${r.manager || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (isAdmin && managerFilter && r.manager !== managerFilter) return false;
      if (contactedFilter && (r.contacted || '').toUpperCase() !== contactedFilter) return false;
      if (preRegFilter && (r.preRegistered || '').toUpperCase() !== preRegFilter) return false;
      if (appJoinFilter) {
        const hasAppJoinDate = !!(r.appJoinDate || '').toString().trim();
        if (appJoinFilter === 'Y' && !hasAppJoinDate) return false;
        if (appJoinFilter === 'N' && hasAppJoinDate) return false;
      }
      return true;
    });
  }, [rows, search, managerFilter, contactedFilter, preRegFilter, appJoinFilter, isAdmin]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const cmp = compareRows(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);
  const rangeStart = sorted.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, sorted.length);
  const pageNumbers = buildPageList(page, totalPages);

  function gotoPage() {
    const n = parseInt(gotoInput, 10);
    if (!n || n < 1 || n > totalPages) return;
    setPage(n);
    setGotoInput('');
  }

  useEffect(() => {
    setPage(1);
  }, [search, managerFilter, contactedFilter, preRegFilter, appJoinFilter, pageSize]);

  function resetFilters() {
    setSearch('');
    setManagerFilter('');
    setContactedFilter('');
    setPreRegFilter('');
    setAppJoinFilter('');
  }

  // 칼럼 제목을 클릭하면 그 칼럼으로 정렬하고, 같은 칼럼을 다시 클릭하면 방향을 반대로 바꿉니다.
  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // 칼럼 머리글의 우측 손잡이를 마우스로 드래그하면 그 칼럼의 너비를 직접 조절합니다.
  function startColumnResize(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[key] || DEFAULT_COL_WIDTH;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    function onMouseMove(ev) {
      const nextWidth = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [key]: nextWidth }));
    }
    function onMouseUp() {
      document.body.style.userSelect = prevUserSelect;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function exportCsv() {
    const cols = DISPLAY_COLUMNS.filter((c) => isAdmin || !c.adminOnly);
    const header = cols.map((c) => csvEscape(c.label)).join(',');
    const body = sorted
      .map((r) => cols.map((c) => csvEscape(DATE_DISPLAY_KEYS.includes(c.key) ? formatDateDisplay(r[c.key]) : r[c.key])).join(','))
      .join('\n');
    const csv = '﻿' + header + '\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `회원목록_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  function openEdit(row) {
    setEditing(row);
    setSaveMsg(null);
  }

  async function handleSave(formValues) {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/members/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: editing.phone, updates: formValues }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: data.error || '저장에 실패했습니다.' });
        setSaving(false);
        return;
      }
      const merged = { ...formValues, ...(data.updates || {}) };
      setRows((prev) =>
        prev.map((r) => (r.phone === editing.phone ? { ...r, ...merged } : r))
      );
      setEditing((prev) => (prev ? { ...prev, ...merged } : prev));
      setSaveMsg(
        data.syncedToManagerSheet
          ? { type: 'ok', text: '저장되었습니다. (담당매니저 개별 시트에도 반영됨)' }
          : { type: 'warn', text: data.warning || '저장되었습니다.' }
      );
    } catch (e) {
      setSaveMsg({ type: 'err', text: '네트워크 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  // 컨택 히스토리 패널에서 메모를 추가하면(서버가 컨택히스토리/최초컨택일자를 갱신) 목록과
  // 열려있는 상세 모달에도 즉시 반영합니다.
  function handleRowFieldsUpdated(updates) {
    setRows((prev) =>
      prev.map((r) => (r.phone === editing.phone ? { ...r, ...updates } : r))
    );
    setEditing((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  async function handleAddDealer(formValues) {
    setAddSaving(true);
    setAddMsg(null);
    try {
      const res = await fetch('/api/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddMsg({ type: 'err', text: data.error || '딜러 추가에 실패했습니다.' });
        setAddSaving(false);
        return;
      }
      setAddMsg(
        data.syncedToManagerSheet
          ? { type: 'ok', text: '딜러가 추가되었습니다. (담당매니저 개별 시트에도 반영됨)' }
          : { type: 'warn', text: data.warning || '딜러가 추가되었습니다.' }
      );
      fetchRows({ silent: true });
    } catch (e) {
      setAddMsg({ type: 'err', text: '네트워크 오류가 발생했습니다.' });
    } finally {
      setAddSaving(false);
    }
  }

  const visibleColumns = DISPLAY_COLUMNS.filter((c) => isAdmin || !c.adminOnly);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">My Dealer</span>
          <span className="topbar-badge">{role}</span>
          <nav className="topbar-nav">
            <Link className="topbar-nav-link active" href="/dashboard">회원관리</Link>
            {REF_SHEETS.map((s) => (
              <Link key={s.key} className="topbar-nav-link" href={`/sheet/${s.key}`}>{s.label}</Link>
            ))}
            {isAdmin && <Link className="topbar-nav-link" href="/accounts">계정관리</Link>}
          </nav>
        </div>
        <div className="topbar-right">
          {adminSheetUrl && (
            <a className="logout-btn" href={adminSheetUrl} target="_blank" rel="noreferrer">
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
            <h1>회원 관리</h1>
            <div className="count">
              검색된 회원 수: {filtered.length.toLocaleString()}명
              {lastSynced && ` · 마지막 동기화: ${lastSynced.toLocaleTimeString('ko-KR')}`}
            </div>
          </div>
        </div>

        <div className="filters-card">
          <div className="filter-field" style={{ minWidth: 240 }}>
            <label>통합검색 (이름/연락처/지점/매니저)</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색어 입력" />
          </div>
          {isAdmin && (
            <div className="filter-field">
              <label>담당매니저</label>
              <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
                <option value="">전체</option>
                {managers.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-field">
            <label>컨택여부</label>
            <select value={contactedFilter} onChange={(e) => setContactedFilter(e.target.value)}>
              <option value="">전체</option>
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </div>
          <div className="filter-field">
            <label>사전예약여부</label>
            <select value={preRegFilter} onChange={(e) => setPreRegFilter(e.target.value)}>
              <option value="">전체</option>
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </div>
          <div className="filter-field">
            <label>App 가입여부</label>
            <select value={appJoinFilter} onChange={(e) => setAppJoinFilter(e.target.value)}>
              <option value="">전체</option>
              <option value="Y">Y (가입)</option>
              <option value="N">N (미가입)</option>
            </select>
          </div>
          <div className="filter-field">
            <label>정렬기준</label>
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(':');
                setSortKey(k);
                setSortDir(d);
              }}
            >
              <option value="registeredAt:desc">최신 등록순</option>
              <option value="name:asc">이름순 (가나다)</option>
            </select>
          </div>
          <div className="filter-actions">
            <button className="btn" onClick={resetFilters}>초기화</button>
            <button className="btn" onClick={() => fetchRows()}>새로고침</button>
            <button className="btn btn-primary" onClick={exportCsv}>엑셀(CSV) 다운로드</button>
            <button className="btn btn-primary" onClick={() => { setAddMsg(null); setAddingDealer(true); }}>
              딜러 추가
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">불러오는 중...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="resizable-table">
                <colgroup>
                  {visibleColumns.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] || DEFAULT_COL_WIDTH }} />
                  ))}
                  <col style={{ width: ACTION_COL_WIDTH }} />
                </colgroup>
                <thead>
                  <tr>
                    {visibleColumns.map((c) => (
                      <th key={c.key} onClick={() => toggleSort(c.key)} style={{ cursor: 'pointer' }}>
                        {c.label}
                        {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        <span
                          className="col-resize-handle"
                          onMouseDown={(e) => startColumnResize(e, c.key)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={visibleColumns.length + 1}>검색 결과가 없습니다.</td>
                    </tr>
                  ) : (
                    paged.map((row) => (
                      <tr key={row.phone + row.rowNumber} onClick={() => openEdit(row)}>
                        {visibleColumns.map((c) => {
                          const val = row[c.key];
                          const isBadgeField = ['contacted', 'smsSent', 'priorityDealer', 'highEfficiency', 'contactSentiment'].includes(c.key);
                          const display = DATE_DISPLAY_KEYS.includes(c.key) ? formatDateDisplay(val) : val;
                          return (
                            <td key={c.key} title={display}>
                              {isBadgeField ? <Badge value={val} /> : (display || '-')}
                            </td>
                          );
                        })}
                        <td>
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(row);
                            }}
                          >
                            수정
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <span className="pagination-summary">
                전체 {sorted.length.toLocaleString()}명 중 {rangeStart}-{rangeEnd}
              </span>
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
              {pageNumbers.map((n, idx) =>
                n === '...' ? (
                  <span key={`ellipsis-${idx}`} className="page-ellipsis">…</span>
                ) : (
                  <button
                    key={n}
                    className={`page-num ${n === page ? 'active' : ''}`}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                )
              )}
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}개씩</option>
                ))}
              </select>
              <span className="page-goto">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={gotoInput}
                  onChange={(e) => setGotoInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && gotoPage()}
                  placeholder="페이지"
                />
                <button onClick={gotoPage}>이동</button>
              </span>
            </div>
          </>
        )}
      </div>

      {editing && (
        <EditModal
          row={editing}
          isAdmin={isAdmin}
          saving={saving}
          message={saveMsg}
          managerOptions={managerOptions}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onRowUpdated={handleRowFieldsUpdated}
        />
      )}

      {changingPassword && (
        <ChangePasswordModal onClose={() => setChangingPassword(false)} />
      )}

      {addingDealer && (
        <AddDealerModal
          isAdmin={isAdmin}
          name={name}
          saving={addSaving}
          message={addMsg}
          managerOptions={managerOptions}
          onClose={() => setAddingDealer(false)}
          onSave={handleAddDealer}
        />
      )}
    </div>
  );
}

// 컨택여부 등 본문 저장 폼에서 다루는 필드 목록입니다. 컨택 히스토리/최초컨택일자는
// 옆의 히스토리 패널이 전용으로 관리하므로(메모 추가 시 즉시 서버에 저장) 본문 저장 폼에서는
// 제외합니다. 같은 값을 두 곳에서 동시에 들고 있다가 저장 시점이 엇갈리면 서로 덮어쓸 수 있기 때문입니다.
function EditModal({ row, isAdmin, saving, message, managerOptions, onClose, onSave, onRowUpdated }) {
  const editableKeys = (isAdmin ? [...MANAGER_EDITABLE, ...ADMIN_ONLY_EDITABLE] : MANAGER_EDITABLE).filter(
    (k) => k !== 'contactHistory' && k !== 'firstContactDate'
  );
  const [form, setForm] = useState(() => {
    const init = {};
    for (const key of editableKeys) init[key] = row[key] || '';
    return init;
  });
  useEscapeKey(onClose);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const adminExtraKeys = MODAL_ADMIN_COLLAPSIBLE_EXTRA.filter((k) => k !== 'lastModifiedBy');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-fixed">
          <div className="modal-header">
            <h2>{row.name}</h2>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>

          {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}

          <div className="modal-header-grid">
            {isAdmin ? (
              <FieldInput fieldKey="group" value={form.group} onChange={update} />
            ) : (
              <ReadOnlyField label={FIELD_META.group.label} value={row.group} />
            )}
            {isAdmin ? (
              <FieldInput fieldKey="brand" value={form.brand} onChange={update} />
            ) : (
              <ReadOnlyField label={FIELD_META.brand.label} value={row.brand} />
            )}
            <ReadOnlyField label="지점/대리점" value={row.branch} />
            <ReadOnlyField label="성명" value={row.name} />
            <ReadOnlyField label="연락처" value={row.phone} />
            <FieldInput fieldKey="contacted" value={form.contacted} onChange={update} />
          </div>
        </div>

        <div className="modal-split-body">
          <div className="modal-main-col">
            {isAdmin && (
              <>
                <div className="modal-section-divider">관리자 전용 항목</div>
                {adminExtraKeys.map((key) => (
                  <FieldInput
                    key={key}
                    fieldKey={key}
                    value={form[key]}
                    onChange={update}
                    managerOptions={managerOptions}
                  />
                ))}
                <ReadOnlyField label="수정자" value={row.lastModifiedBy} />
              </>
            )}

            <CollapsibleSection title="상세 정보">
              {MODAL_COMMON_COLLAPSIBLE.map((key) => {
                if (key === 'firstContactDate') {
                  return (
                    <ReadOnlyField
                      key={key}
                      label="최초컨택일자"
                      value={formatDateDisplay(row.firstContactDate)}
                      placeholder="컨택 히스토리 등록 시 자동 입력"
                    />
                  );
                }
                if (isAdmin || MANAGER_EDITABLE.includes(key)) {
                  return <FieldInput key={key} fieldKey={key} value={form[key]} onChange={update} />;
                }
                return <ReadOnlyField key={key} label={FIELD_META[key].label} value={row[key]} />;
              })}
            </CollapsibleSection>

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>취소</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => onSave(form)}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>

          <div className="modal-side-col">
            <ContactHistoryPanel row={row} onUpdated={onRowUpdated} />
          </div>
        </div>
      </div>
    </div>
  );
}

// 딜러 상세 화면에서 항상 보이는 읽기 전용 정보 한 칸을 그립니다.
function ReadOnlyField({ label, value, placeholder }) {
  return (
    <div className="modal-field modal-field-readonly">
      <label>{label}</label>
      <div className="readonly-value">{value || placeholder || '-'}</div>
    </div>
  );
}

// 기본은 접혀있고, 클릭하면 펼쳐지는 섹션입니다. "중요하지 않은 항목"을 평소엔 숨겨서
// 화면을 간단하게 보여주고, 필요할 때만 펼쳐서 보게 합니다.
function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-section">
      <button type="button" className="collapsible-toggle" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className={`collapsible-chevron ${open ? 'open' : ''}`}>▾</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

// 등록 시각 문자열("YYYY-MM-DD HH:mm:ss")을 "n분 전" 같은 상대 시간으로 바꿔줍니다.
// 일주일이 지난 항목은 상대 시간 대신 날짜만 보여줍니다.
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const ts = Date.parse(timestamp.replace(' ', 'T'));
  if (!ts) return timestamp;
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return timestamp.slice(0, 10);
}

// 딜러를 클릭했을 때 옆에 표시되는 상담 메모 피드입니다. 메모 추가는 본문 저장 폼과 별도로
// 즉시 서버에 반영됩니다(같은 값을 두 곳에서 들고 있다가 저장 시점이 엇갈리는 걸 방지).
function ContactHistoryPanel({ row, onUpdated }) {
  const [contactHistory, setContactHistory] = useState(row.contactHistory || '');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const notes = useMemo(() => parseContactHistory(contactHistory), [contactHistory]);

  async function submitNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/members/add-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: row.phone, text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '메모 저장에 실패했습니다.');
        setSaving(false);
        return;
      }
      setContactHistory(data.updates.contactHistory);
      setNoteText('');
      if (onUpdated) onUpdated(data.updates);
    } catch (e) {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="history-panel">
      <div className="history-section-title">컨택 히스토리</div>
      <div className="history-feed">
        {notes.length === 0 ? (
          <div className="history-empty">등록된 메모가 없습니다.</div>
        ) : (
          notes.map((n, i) => (
            <div className="history-note" key={i}>
              <div className="history-note-meta">
                {n.author && <span className="history-note-author">{n.author}</span>}
                {n.timestamp && <span className="history-note-time">{formatRelativeTime(n.timestamp)}</span>}
              </div>
              <div className="history-note-text">{n.text}</div>
            </div>
          ))
        )}
      </div>

      <div className="history-add-box">
        {error && <div className="modal-message err">{error}</div>}
        <textarea
          value={noteText}
          maxLength={300}
          placeholder="상담 내용을 입력해주세요"
          onChange={(e) => setNoteText(e.target.value)}
        />
        <div className="history-add-footer">
          <span className="history-char-count">{noteText.length}/300자</span>
          <button className="btn btn-primary" disabled={saving || !noteText.trim()} onClick={submitNote}>
            {saving ? '저장 중...' : '메모 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 딜러 추가 모달도 상세 모달과 같은 3단계 순서(상시노출/접어두기)를 따릅니다. 다만 최초컨택일자는
// 등록 시점엔 항상 비어있어(컨택 히스토리를 적어야 자동으로 채워지므로) 입력칸으로 보여줄 필요가 없어 제외합니다.
function AddDealerModal({ isAdmin, name, saving, message, managerOptions, onClose, onSave }) {
  // 매니저는 다른 매니저에게 배분(manager)하거나 본인이 볼 수 없는 관리자 특이사항(adminNote)은 입력할 수 없습니다.
  const collapsibleKeys = MODAL_COMMON_COLLAPSIBLE.filter((k) => k !== 'firstContactDate');
  const baseKeys = ['group', 'brand', 'branch', 'name', 'phone', 'contacted', 'contactHistory', ...collapsibleKeys];
  const adminExtraKeys = MODAL_ADMIN_COLLAPSIBLE_EXTRA.filter((k) => k !== 'lastModifiedBy');
  const fieldKeys = isAdmin ? [...baseKeys, ...adminExtraKeys] : baseKeys;
  const [form, setForm] = useState(() => {
    const init = {};
    for (const key of fieldKeys) init[key] = '';
    return init;
  });
  const [validationError, setValidationError] = useState('');
  useEscapeKey(onClose);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (!form.name.trim() || !form.phone.trim()) {
      setValidationError('이름과 연락처는 필수 입력 항목입니다.');
      return;
    }
    setValidationError('');
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-fixed">
          <div className="modal-header">
            <div>
              <h2>딜러 추가</h2>
              <div className="sub">
                새로운 딜러 정보를 입력해주세요. (이름·연락처는 필수)
                {!isAdmin && ` 담당매니저는 본인(${name})으로 자동 등록됩니다.`}
              </div>
            </div>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>

          {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}
          {validationError && <div className="modal-message err">{validationError}</div>}

          <div className="modal-header-grid">
            <FieldInput fieldKey="group" value={form.group} onChange={update} />
            <FieldInput fieldKey="brand" value={form.brand} onChange={update} />
            <FieldInput fieldKey="branch" value={form.branch} onChange={update} />
            <FieldInput fieldKey="name" value={form.name} onChange={update} />
            <FieldInput fieldKey="phone" value={form.phone} onChange={update} />
            <FieldInput fieldKey="contacted" value={form.contacted} onChange={update} />
          </div>
        </div>

        <div className="modal-split-body modal-split-body-single">
          <div className="modal-main-col">
            <FieldInput fieldKey="contactHistory" value={form.contactHistory} onChange={update} />

            {isAdmin && (
              <>
                <div className="modal-section-divider">관리자 전용 항목</div>
                {adminExtraKeys.map((key) => (
                  <FieldInput
                    key={key}
                    fieldKey={key}
                    value={form[key]}
                    onChange={update}
                    managerOptions={managerOptions}
                  />
                ))}
              </>
            )}

            <CollapsibleSection title="상세 정보">
              {collapsibleKeys.map((key) => (
                <FieldInput key={key} fieldKey={key} value={form[key]} onChange={update} />
              ))}
            </CollapsibleSection>

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>닫기</button>
              <button className="btn btn-primary" disabled={saving} onClick={submit}>
                {saving ? '추가 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ fieldKey, value, onChange, managerOptions }) {
  const meta = FIELD_META[fieldKey] || { label: fieldKey, type: 'text' };
  // 담당매니저는 계정관리에 등록된 매니저 이름만 드롭박스로 선택하게 합니다. (오타·미등록 이름 방지)
  if (fieldKey === 'manager' && Array.isArray(managerOptions)) {
    const options = value && !managerOptions.includes(value) ? [value, ...managerOptions] : managerOptions;
    return (
      <div className="modal-field">
        <label>{meta.label}{meta.required && <span className="required-mark"> *</span>}</label>
        <select value={value} onChange={(e) => onChange(fieldKey, e.target.value)}>
          <option value="">(미선택)</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="modal-field">
      <label>{meta.label}{meta.required && <span className="required-mark"> *</span>}</label>
      {meta.type === 'select' ? (
        <select value={value} onChange={(e) => onChange(fieldKey, e.target.value)}>
          {meta.options.map((opt) => {
            const { value: optValue, label: optLabel } =
              typeof opt === 'string' ? { value: opt, label: opt === '' ? '(미입력)' : opt } : opt;
            return (
              <option key={optValue} value={optValue}>{optLabel}</option>
            );
          })}
        </select>
      ) : meta.type === 'textarea' ? (
        <textarea value={value} onChange={(e) => onChange(fieldKey, e.target.value)} />
      ) : meta.type === 'date' ? (
        <input
          type="date"
          value={formatDateDisplay(value)}
          onChange={(e) => onChange(fieldKey, e.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={meta.placeholder}
          onChange={(e) => onChange(fieldKey, e.target.value)}
        />
      )}
    </div>
  );
}
