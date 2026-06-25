import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';
import { DISPLAY_COLUMNS, MANAGER_EDITABLE, ADMIN_ONLY_EDITABLE } from '../lib/sheetSchema';
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
  firstContactDate: { label: '최초컨택일자', type: 'text', placeholder: '예: 2025-08-28' },
  reContactDate: { label: '재컨택일자', type: 'text', placeholder: '예: 2025-09-01' },
  smsSent: { label: '문자여부', type: 'select', options: ['', 'Y', 'N'] },
  contactSentiment: { label: '컨택 호의도', type: 'select', options: ['', 'A', 'B', 'C'] },
  contactHistory: { label: '컨택 히스토리', type: 'textarea' },
  preRegistered: { label: '사전예약여부', type: 'select', options: ['', 'Y', 'N'] },
  group: { label: '그룹', type: 'text' },
  brand: { label: '브랜드', type: 'text' },
  wideInsta: { label: '광역/인스타', type: 'text' },
  region: { label: '권역', type: 'text' },
  branch: { label: '지점/대리점 명', type: 'text' },
  manager: { label: '담당매니저', type: 'text' },
  assignedDate: { label: '배분일자', type: 'text' },
  priorityDealer: { label: '우선컨택 딜러여부', type: 'select', options: ['', 'Y', 'N'] },
  highEfficiency: { label: '고효율딜러여부', type: 'select', options: ['', 'Y', 'N'] },
  highEfficiencyScore: { label: '고효율딜러수치', type: 'text' },
  appJoinDate: { label: 'App가입일자', type: 'text' },
  totalContracts: { label: '누적 계약체결건수', type: 'text' },
  last60dContracts: { label: '직전 60일 계약체결건수', type: 'text' },
  last1yTop10: { label: '직전 1년 본인 10% 횟수', type: 'text' },
  adminNote: { label: '관리자 특이사항', type: 'textarea' },
};

const PAGE_SIZE = 50;

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
  const [page, setPage] = useState(1);

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
      return true;
    });
  }, [rows, search, managerFilter, contactedFilter, preRegFilter, isAdmin]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const cmp = compareRows(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, managerFilter, contactedFilter, preRegFilter]);

  function resetFilters() {
    setSearch('');
    setManagerFilter('');
    setContactedFilter('');
    setPreRegFilter('');
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

  function exportCsv() {
    const cols = DISPLAY_COLUMNS.filter((c) => isAdmin || !c.adminOnly);
    const header = cols.map((c) => csvEscape(c.label)).join(',');
    const body = sorted
      .map((r) => cols.map((c) => csvEscape(r[c.key])).join(','))
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
      setRows((prev) =>
        prev.map((r) => (r.phone === editing.phone ? { ...r, ...formValues } : r))
      );
      setEditing((prev) => (prev ? { ...prev, ...formValues } : prev));
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
          <span className="topbar-title">AJF 회원 관리 대시보드</span>
          <span className="topbar-badge">{role}</span>
          <nav className="topbar-nav">
            <Link className="topbar-nav-link active" href="/dashboard">회원관리</Link>
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
              <table>
                <thead>
                  <tr>
                    {visibleColumns.map((c) => (
                      <th key={c.key} onClick={() => toggleSort(c.key)} style={{ cursor: 'pointer' }}>
                        {c.label}
                        {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
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
                          const isBadgeField = ['contacted', 'smsSent', 'preRegistered', 'priorityDealer', 'highEfficiency', 'contactSentiment'].includes(c.key);
                          return (
                            <td key={c.key} title={val}>
                              {isBadgeField ? <Badge value={val} /> : (val || '-')}
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
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</button>
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

function EditModal({ row, isAdmin, saving, message, managerOptions, onClose, onSave }) {
  const editableKeys = isAdmin ? [...MANAGER_EDITABLE, ...ADMIN_ONLY_EDITABLE] : MANAGER_EDITABLE;
  const [form, setForm] = useState(() => {
    const init = {};
    for (const key of editableKeys) init[key] = row[key] || '';
    return init;
  });
  useEscapeKey(onClose);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // 화면에 보여주는 순서만 관리자 특이사항을 맨 위로 올립니다. (데이터/권한 배열인 ADMIN_ONLY_EDITABLE 자체는 그대로 둡니다)
  const adminDetailOrder = ['adminNote', ...ADMIN_ONLY_EDITABLE.filter((k) => k !== 'adminNote')];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{row.name}</h2>
            <div className="sub">{row.phone} · {row.branch || '-'} · 담당매니저 {row.manager || '-'}</div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-readonly-grid">
          <div><span className="k">그룹</span> {row.group || '-'}</div>
          <div><span className="k">브랜드</span> {row.brand || '-'}</div>
          <div><span className="k">권역</span> {row.region || '-'}</div>
          <div><span className="k">배분일자</span> {row.assignedDate || '-'}</div>
          {isAdmin && <div><span className="k">수정자</span> {row.lastModifiedBy || '-'}</div>}
        </div>

        {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}

        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>컨택 정보</div>
        {MANAGER_EDITABLE.map((key) => (
          <FieldInput key={key} fieldKey={key} value={form[key]} onChange={update} />
        ))}

        {isAdmin && (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '18px 0 10px' }}>관리자 전용 항목</div>
            {adminDetailOrder.map((key) => (
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

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(form)}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddDealerModal({ isAdmin, name, saving, message, managerOptions, onClose, onSave }) {
  // 매니저는 다른 매니저에게 배분(manager)하거나 본인이 볼 수 없는 관리자 특이사항(adminNote)은 입력할 수 없습니다.
  const detailKeys = isAdmin
    ? ADMIN_ONLY_EDITABLE
    : ADMIN_ONLY_EDITABLE.filter((k) => k !== 'manager' && k !== 'adminNote');
  const fieldKeys = ['name', 'phone', ...detailKeys];
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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

        <FieldInput fieldKey="name" value={form.name} onChange={update} />
        <FieldInput fieldKey="phone" value={form.phone} onChange={update} />

        <div style={{ fontWeight: 700, fontSize: 13, margin: '18px 0 10px' }}>
          {isAdmin ? '관리자 전용 항목' : '상세 정보'}
        </div>
        {detailKeys.map((key) => (
          <FieldInput
            key={key}
            fieldKey={key}
            value={form[key]}
            onChange={update}
            managerOptions={managerOptions}
          />
        ))}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? '추가 중...' : '추가'}
          </button>
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
          {meta.options.map((opt) => (
            <option key={opt} value={opt}>{opt === '' ? '(미입력)' : opt}</option>
          ))}
        </select>
      ) : meta.type === 'textarea' ? (
        <textarea value={value} onChange={(e) => onChange(fieldKey, e.target.value)} />
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
