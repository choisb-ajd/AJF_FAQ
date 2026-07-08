import { useEffect, useMemo, useState } from 'react';
import {
  INTAKE_ADMIN_FIELDS,
  INTAKE_ADMIN_EDITABLE,
  INTAKE_DISPLAY_COLUMNS,
  INTAKE_MANAGER_DISPLAY_COLUMNS,
  INTAKE_STORE_EDITABLE,
  formatDateDisplay,
} from '../lib/sheetSchema';
import useEscapeKey from '../lib/useEscapeKey';
import { getEntry, fetchAndCache, mergeEntry } from '../lib/dataCache';

const FIELD_META = Object.fromEntries(INTAKE_ADMIN_FIELDS.map((f) => [f.key, f]));
const DATE_KEYS = ['dupCheckDate', 'insuranceJoinDate', 'giftGivenDate', 'cancelDate', 'secondChoiceDate', 'birthDate'];
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const INTAKE_KEY = 'intake';
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30분 — 자동 업데이트 주기 (설문 인입은 실시간성이 중요해 짧게)

function maskPhone(phone) {
  if (!phone) return '-';
  return String(phone).replace(/(\d{4})$/, '****');
}

function maskResidentNumber(num) {
  if (!num) return '-';
  const clean = String(num).replace(/[\s-]/g, '');
  const front = clean.slice(0, 6);
  if (!front) return '-';
  return `${front}-*`;
}

function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

// 상담상태·키트수령안내여부 등은 매장/상담원이 자유롭게 적어온 문구라 값 종류가 다양합니다.
// 정확한 값 목록으로 배지를 나누는 대신, 문구에 포함된 키워드로 대략적인 색만 구분해 보여줍니다.
function StatusBadge({ value }) {
  const v = (value || '').trim();
  if (!v) return <span className="badge badge-pending">대기</span>;
  if (/거절|취소|미적용|제외/.test(v)) return <span className="badge badge-bad">{v}</span>;
  if (/완료|가입|체결|^Y$/i.test(v)) return <span className="badge badge-y">{v}</span>;
  return <span className="badge badge-progress">{v}</span>;
}

function fieldLabel(key) {
  return FIELD_META[key]?.label || key;
}

export default function IntakeRegistry({ isAdmin, name }) {
  const initial = getEntry(INTAKE_KEY);
  const [rows, setRows] = useState(() => (initial ? initial.data.rows || [] : []));
  const [loading, setLoading] = useState(() => !initial);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dupCheckFilter, setDupCheckFilter] = useState('');
  const [kitFilter, setKitFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [gotoInput, setGotoInput] = useState('');
  const [sortDir, setSortDir] = useState('desc'); // 접수 순서(행 번호) 기준 — 최신순 기본

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  async function fetchRows({ silent = false, force = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await fetchAndCache(INTAKE_KEY, '/api/intake', { force });
      if (data) setRows(data.rows || []);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function updateRowsLocal(updater) {
    setRows((prev) => {
      const next = updater(prev);
      mergeEntry(INTAKE_KEY, { rows: next });
      return next;
    });
  }

  async function handleManualRefresh() {
    await fetchRows({ force: true });
    setRefreshTick((t) => t + 1);
  }

  useEffect(() => {
    if (!getEntry(INTAKE_KEY)) fetchRows();
  }, []);

  useEffect(() => {
    if (editing) return;
    const entry = getEntry(INTAKE_KEY);
    const age = entry ? Date.now() - entry.fetchedAt : 0;
    const delay = entry ? Math.max(0, POLL_INTERVAL_MS - age) : POLL_INTERVAL_MS;
    let interval;
    const timeout = setTimeout(() => {
      fetchRows({ silent: true });
      interval = setInterval(() => fetchRows({ silent: true }), POLL_INTERVAL_MS);
    }, delay);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [editing, refreshTick]);

  const branches = useMemo(() => {
    const set = new Set(rows.map((r) => r.values.branch).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const statuses = useMemo(() => {
    const set = new Set(rows.map((r) => r.values.consultStatus).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const v = r.values;
      if (q) {
        const hay = `${v.name || ''} ${v.phoneLast4 || v.phone || ''} ${v.referrer || ''} ${v.branch || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (branchFilter && v.branch !== branchFilter) return false;
      if (statusFilter && v.consultStatus !== statusFilter) return false;
      if (dupCheckFilter === 'pending' && v.dupCheckDate) return false;
      if (dupCheckFilter === 'done' && !v.dupCheckDate) return false;
      if (kitFilter === 'pending' && v.kitGuideStatus) return false;
      if (kitFilter === 'done' && !v.kitGuideStatus) return false;
      return true;
    });
  }, [rows, search, branchFilter, statusFilter, dupCheckFilter, kitFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => (sortDir === 'asc' ? a.rowNumber - b.rowNumber : b.rowNumber - a.rowNumber));
    return list;
  }, [filtered, sortDir]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    const dupPending = filtered.filter((r) => !r.values.dupCheckDate).length;
    const kitPending = filtered.filter((r) => !r.values.kitGuideStatus).length;
    const joined = filtered.filter((r) => (r.values.insuranceJoinDate || '').trim()).length;
    const immediate = filtered.filter((r) => (r.values.immediateApply || '').trim().toUpperCase() === 'Y').length;
    const rejected = filtered.filter((r) => (r.values.consultStatus || '').includes('거절')).length;
    return { total, dupPending, kitPending, joined, immediate, rejected };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);
  const rangeStart = sorted.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, sorted.length);
  const pageNumbers = buildPageList(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [search, branchFilter, statusFilter, dupCheckFilter, kitFilter, pageSize]);

  function gotoPage() {
    const n = parseInt(gotoInput, 10);
    if (!n || n < 1 || n > totalPages) return;
    setPage(n);
    setGotoInput('');
  }

  function resetFilters() {
    setSearch('');
    setBranchFilter('');
    setStatusFilter('');
    setDupCheckFilter('');
    setKitFilter('');
  }

  function openEdit(row) {
    setEditing(row);
    setSaveMsg(null);
  }

  async function handleSave(formValues) {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/intake/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowNumber: editing.rowNumber,
          timestamp: editing.values.timestamp,
          name: editing.values.name,
          updates: formValues,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: data.error || '저장에 실패했습니다.' });
        setSaving(false);
        return;
      }
      const merged = { ...formValues, ...(data.updates || {}) };
      updateRowsLocal((prev) =>
        prev.map((r) => (r.rowNumber === editing.rowNumber ? { ...r, values: { ...r.values, ...merged } } : r))
      );
      setEditing((prev) => (prev ? { ...prev, values: { ...prev.values, ...merged } } : prev));
      setSaveMsg({ type: 'ok', text: '저장되었습니다.' });
    } catch (e) {
      setSaveMsg({ type: 'err', text: '네트워크 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  const displayKeys = isAdmin ? INTAKE_DISPLAY_COLUMNS : INTAKE_MANAGER_DISPLAY_COLUMNS;

  return (
    <>
      <div className="kpi-row">
        <div className="kpi-tile">
          <div className="kpi-value">{kpis.total.toLocaleString()}</div>
          <div className="kpi-label">접수 건수</div>
        </div>
        {isAdmin && (
          <div className="kpi-tile">
            <div className="kpi-value">{kpis.immediate.toLocaleString()}</div>
            <div className="kpi-label">즉시신청</div>
          </div>
        )}
        <div className="kpi-tile">
          <div className="kpi-value kpi-warn">{kpis.dupPending.toLocaleString()}</div>
          <div className="kpi-label">중복보장점검 대기</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-value kpi-warn">{kpis.kitPending.toLocaleString()}</div>
          <div className="kpi-label">키트안내 대기</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-value kpi-good">{kpis.joined.toLocaleString()}</div>
          <div className="kpi-label">보험가입 완료</div>
        </div>
        {isAdmin && (
          <div className="kpi-tile">
            <div className="kpi-value">{kpis.rejected.toLocaleString()}</div>
            <div className="kpi-label">거절</div>
          </div>
        )}
      </div>

      <div className="filters-card">
        <div className="filter-field" style={{ minWidth: 220 }}>
          <label>통합검색 (이름/연락처뒤4자리/추천인/지점)</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색어 입력" />
        </div>
        <div className="filter-field">
          <label>지점</label>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">전체</option>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>상담상태</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">전체</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>중복보장점검</label>
          <select value={dupCheckFilter} onChange={(e) => setDupCheckFilter(e.target.value)}>
            <option value="">전체</option>
            <option value="pending">대기</option>
            <option value="done">완료</option>
          </select>
        </div>
        <div className="filter-field">
          <label>키트수령안내</label>
          <select value={kitFilter} onChange={(e) => setKitFilter(e.target.value)}>
            <option value="">전체</option>
            <option value="pending">대기</option>
            <option value="done">완료</option>
          </select>
        </div>
        <div className="filter-field">
          <label>정렬</label>
          <select value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
            <option value="desc">최신 접수순</option>
            <option value="asc">오래된 접수순</option>
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn" onClick={resetFilters}>초기화</button>
          <button className="btn" onClick={handleManualRefresh}>새로고침</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">불러오는 중...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : (
        <>
          <div className="count">검색된 건수: {filtered.length.toLocaleString()}건</div>
          <div className="table-wrap">
            <table className="resizable-table">
              <thead>
                <tr>
                  {displayKeys.map((key) => (
                    <th key={key}>{fieldLabel(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={displayKeys.length}>검색 결과가 없습니다.</td>
                  </tr>
                ) : (
                  paged.map((row) => (
                    <tr key={row.rowNumber} onClick={() => openEdit(row)}>
                      {displayKeys.map((key) => {
                        const val = row.values[key];
                        const rawDisplay = DATE_KEYS.includes(key) ? formatDateDisplay(val) : val;
                        const isStatusField = ['consultStatus', 'kitGuideStatus', 'insuranceJoined'].includes(key);
                        return (
                          <td key={key} title={rawDisplay}>
                            {key === 'dupCheckDate' ? (
                              val ? formatDateDisplay(val) : <span className="badge badge-pending">대기</span>
                            ) : isStatusField ? (
                              <StatusBadge value={val} />
                            ) : (
                              rawDisplay || '-'
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

          <div className="pagination">
            <span className="pagination-summary">
              전체 {sorted.length.toLocaleString()}건 중 {rangeStart}-{rangeEnd}
            </span>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
            {pageNumbers.map((n, idx) =>
              n === '...' ? (
                <span key={`ellipsis-${idx}`} className="page-ellipsis">…</span>
              ) : (
                <button key={n} className={`page-num ${n === page ? 'active' : ''}`} onClick={() => setPage(n)}>
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

      {editing && (
        <IntakeDetailModal
          row={editing}
          isAdmin={isAdmin}
          name={name}
          saving={saving}
          message={saveMsg}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="modal-field modal-field-readonly">
      <label>{label}</label>
      <div className="readonly-value">{value || '-'}</div>
    </div>
  );
}

function FieldInput({ fieldKey, value, onChange, multiline }) {
  const meta = FIELD_META[fieldKey];
  return (
    <div className="modal-field">
      <label>{meta.label}</label>
      {DATE_KEYS.includes(fieldKey) ? (
        <input type="date" value={formatDateDisplay(value)} onChange={(e) => onChange(fieldKey, e.target.value)} />
      ) : multiline ? (
        <textarea value={value} onChange={(e) => onChange(fieldKey, e.target.value)} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(fieldKey, e.target.value)} />
      )}
    </div>
  );
}

// 진행상황 입력 항목 중 여러 줄 입력이 자연스러운 항목(상담결과 메모, 특이사항 등)
const MULTILINE_KEYS = new Set(['consultNote', 'storeNote']);

// 관리자: 설문 원본(읽기전용) + 보험사업부 진행상황(수정) + 매장 입력(수정).
// 매니저(매장): 설문에서 매장이 알아야 할 최소 정보(읽기전용) + 매장 입력(수정) + 진행상황(읽기전용 확인용).
function IntakeDetailModal({ row, isAdmin, name, saving, message, onClose, onSave }) {
  const editableKeys = isAdmin ? [...INTAKE_ADMIN_EDITABLE, ...INTAKE_STORE_EDITABLE] : INTAKE_STORE_EDITABLE;
  const [form, setForm] = useState(() => {
    const init = {};
    for (const key of editableKeys) init[key] = row.values[key] || '';
    return init;
  });
  useEscapeKey(onClose);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const surveyKeys = isAdmin
    ? ['name', 'phone', 'residentNumber', 'birthDate', 'immediateApply', 'immediateApplyLabel', 'secondChoiceDate', 'secondChoiceTime', 'region', 'branch', 'referrer', 'drivingInterest', 'ownCar', 'surgeryHistory', 'giftChoice']
    : ['name', 'branch', 'referrer', 'giftChoice'];

  const adminProgressKeys = INTAKE_ADMIN_EDITABLE;
  // 매니저 화면에서 확인용(읽기전용)으로 보여줄 진행상황 항목
  const managerProgressReadKeys = ['dupCheckDate', 'kitGuideStatus', 'consultStatus', 'insuranceJoinDate', 'incentiveExcluded', 'before0610'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-fixed">
          <div className="modal-header">
            <h2>{row.values.name}</h2>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
          {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}
          <div className="modal-header-grid">
            <ReadOnlyField label="일시" value={row.values.timestamp} />
            <ReadOnlyField label="지점" value={row.values.branch} />
            <ReadOnlyField label="추천인" value={row.values.referrer} />
            <ReadOnlyField label="연락처" value={isAdmin ? maskPhone(row.values.phone) : row.values.phoneLast4} />
            {isAdmin && <ReadOnlyField label="주민번호" value={maskResidentNumber(row.values.residentNumber)} />}
            <ReadOnlyField label="상담상태" value={row.values.consultStatus} />
          </div>
        </div>

        <div className="modal-split-body modal-split-body-single">
          <div className="modal-main-col">
            <div className="modal-section-divider">설문 접수 정보 (읽기전용)</div>
            {surveyKeys.map((key) => (
              <ReadOnlyField
                key={key}
                label={fieldLabel(key)}
                value={DATE_KEYS.includes(key) ? formatDateDisplay(row.values[key]) : row.values[key]}
              />
            ))}

            {isAdmin && (
              <>
                <div className="modal-section-divider">보험사업부 진행상황</div>
                {adminProgressKeys.map((key) => (
                  <FieldInput key={key} fieldKey={key} value={form[key]} onChange={update} multiline={MULTILINE_KEYS.has(key)} />
                ))}
              </>
            )}

            {!isAdmin && (
              <>
                <div className="modal-section-divider">진행상황 (읽기전용 — 보험사업부에서 관리)</div>
                {managerProgressReadKeys.map((key) => (
                  <ReadOnlyField
                    key={key}
                    label={fieldLabel(key)}
                    value={DATE_KEYS.includes(key) ? formatDateDisplay(row.values[key]) : row.values[key]}
                  />
                ))}
              </>
            )}

            <div className="modal-section-divider">매장 입력 항목</div>
            {INTAKE_STORE_EDITABLE.map((key) => (
              <FieldInput key={key} fieldKey={key} value={form[key]} onChange={update} multiline={MULTILINE_KEYS.has(key)} />
            ))}

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>취소</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => onSave(form)}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
