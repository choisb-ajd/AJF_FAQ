import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RENEWAL_FIELDS,
  RENEWAL_MANAGER_EDITABLE,
  RENEWAL_ADMIN_ONLY_EDITABLE,
  formatDateDisplay,
  parseContactHistory,
} from '../lib/sheetSchema';
import useEscapeKey from '../lib/useEscapeKey';

const FIELD_META = Object.fromEntries(RENEWAL_FIELDS.map((f) => [f.key, f]));
const DATE_KEYS = ['assignedDate', 'expiryDate', 'dealerLastContractDate'];
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

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
  return <span>{value}</span>;
}

function compareRows(a, b, key) {
  const av = a.values[key] || '';
  const bv = b.values[key] || '';
  if (DATE_KEYS.includes(key)) {
    return (Date.parse(av) || 0) - (Date.parse(bv) || 0);
  }
  return av.toString().localeCompare(bv.toString(), 'ko');
}

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1시간 — 자동 업데이트 주기

// 다른 탭에 갔다가 돌아와도(같은 브라우저 탭 안에서는) 마지막으로 불러온 데이터를 그대로 재사용해
// 재방문 시 로딩 화면 없이 바로 표가 보이고, 다음 자동 업데이트 전까지는 같은 데이터를 유지합니다.
let renewalCache = { rows: null, etag: null, fetchedAt: 0 };

export default function RenewalRegistry({ isAdmin, name }) {
  const [rows, setRows] = useState(() => renewalCache.rows || []);
  const [loading, setLoading] = useState(() => !renewalCache.rows);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const etagRef = useRef(renewalCache.etag);

  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [recent60dFilter, setRecent60dFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [gotoInput, setGotoInput] = useState('');
  const [sortKey, setSortKey] = useState('assignedDate');
  const [sortDir, setSortDir] = useState('desc');

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // force=true면 서버 캐시까지 건너뛰고 구글 시트에서 바로 최신 데이터를 가져옵니다("새로고침" 버튼 전용).
  async function fetchRows({ silent = false, force = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const headers = {};
      if (!force && etagRef.current) headers['If-None-Match'] = etagRef.current;
      const res = await fetch(force ? '/api/renewal?force=1' : '/api/renewal', { headers });

      if (res.status === 304) {
        renewalCache.fetchedAt = Date.now();
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '데이터를 불러오지 못했습니다.');

      const etag = res.headers.get('ETag');
      if (etag) etagRef.current = etag;

      setRows(data.rows || []);
      renewalCache = { rows: data.rows || [], etag: etagRef.current, fetchedAt: Date.now() };
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // 로컬에서 즉시 반영하는 변경(저장/통화이력 추가)도 캐시에 함께 기록해둬야
  // 다른 탭에 갔다가 돌아왔을 때 방금 한 수정 내용이 사라지지 않습니다.
  function updateRowsLocal(updater) {
    setRows((prev) => {
      const next = updater(prev);
      renewalCache.rows = next;
      return next;
    });
  }

  async function handleManualRefresh() {
    await fetchRows({ force: true });
    setRefreshTick((t) => t + 1);
  }

  useEffect(() => {
    if (!renewalCache.rows) {
      fetchRows();
    }
  }, []);

  // 편집창이 열려있지 않을 때, 캐시된 데이터를 마지막으로 불러온 시점 기준 1시간 후에
  // 자동으로 한 번 조용히 새 데이터를 가져옵니다. 그 전까지는 같은 데이터를 그대로 보여줍니다.
  useEffect(() => {
    if (editing) return;
    const age = Date.now() - renewalCache.fetchedAt;
    const delay = renewalCache.rows ? Math.max(0, POLL_INTERVAL_MS - age) : POLL_INTERVAL_MS;
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

  const managers = useMemo(() => {
    const set = new Set(rows.map((r) => r.values.manager).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.values.renewalMonth).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const v = r.values;
      if (q) {
        const hay = `${v.customerName || ''} ${v.phone || ''} ${v.carNumber || ''} ${v.dealerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (isAdmin && managerFilter && v.manager !== managerFilter) return false;
      if (monthFilter && v.renewalMonth !== monthFilter) return false;
      if (recent60dFilter && (v.dealerRecent60d || '').toUpperCase() !== recent60dFilter) return false;
      return true;
    });
  }, [rows, search, managerFilter, monthFilter, recent60dFilter, isAdmin]);

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

  useEffect(() => {
    setPage(1);
  }, [search, managerFilter, monthFilter, recent60dFilter, pageSize]);

  function gotoPage() {
    const n = parseInt(gotoInput, 10);
    if (!n || n < 1 || n > totalPages) return;
    setPage(n);
    setGotoInput('');
  }

  function resetFilters() {
    setSearch('');
    setManagerFilter('');
    setMonthFilter('');
    setRecent60dFilter('');
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function openEdit(row) {
    setEditing(row);
    setSaveMsg(null);
  }

  async function handleSave(formValues) {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/renewal/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowNumber: editing.rowNumber, updates: formValues }),
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

  function handleHistoryUpdated(callHistory) {
    updateRowsLocal((prev) =>
      prev.map((r) => (r.rowNumber === editing.rowNumber ? { ...r, values: { ...r.values, callHistory } } : r))
    );
    setEditing((prev) => (prev ? { ...prev, values: { ...prev.values, callHistory } } : prev));
  }

  const visibleColumns = RENEWAL_FIELDS.filter((f) => (isAdmin || !f.adminOnly) && f.key !== 'callHistory');

  return (
    <>
      <div className="filters-card">
        <div className="filter-field" style={{ minWidth: 240 }}>
          <label>통합검색 (고객명/연락처/차량번호/딜러이름)</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색어 입력" />
        </div>
        {isAdmin && (
          <div className="filter-field">
            <label>갱신담당매니저</label>
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
              <option value="">전체</option>
              {managers.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        <div className="filter-field">
          <label>갱신월</label>
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
            <option value="">전체</option>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>딜러 직전 60일 계약여부</label>
          <select value={recent60dFilter} onChange={(e) => setRecent60dFilter(e.target.value)}>
            <option value="">전체</option>
            <option value="Y">Y</option>
            <option value="N">N</option>
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
                  {visibleColumns.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} style={{ cursor: 'pointer' }}>
                      {c.label}
                      {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={visibleColumns.length}>검색 결과가 없습니다.</td>
                  </tr>
                ) : (
                  paged.map((row) => (
                    <tr key={row.rowNumber} onClick={() => openEdit(row)}>
                      {visibleColumns.map((c) => {
                        const val = row.values[c.key];
                        const display = DATE_KEYS.includes(c.key) ? formatDateDisplay(val) : val;
                        return (
                          <td key={c.key} title={display}>
                            {c.key === 'dealerRecent60d' ? <Badge value={val} /> : (display || '-')}
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
        <RenewalEditModal
          row={editing}
          isAdmin={isAdmin}
          name={name}
          saving={saving}
          message={saveMsg}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onHistoryUpdated={handleHistoryUpdated}
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

function FieldInput({ fieldKey, value, onChange }) {
  const meta = FIELD_META[fieldKey];
  return (
    <div className="modal-field">
      <label>{meta.label}</label>
      {meta.type === 'select' ? (
        <select value={value} onChange={(e) => onChange(fieldKey, e.target.value)}>
          {meta.options.map((opt) => (
            <option key={opt} value={opt}>{opt === '' ? '(미입력)' : opt}</option>
          ))}
        </select>
      ) : DATE_KEYS.includes(fieldKey) ? (
        <input type="date" value={formatDateDisplay(value)} onChange={(e) => onChange(fieldKey, e.target.value)} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(fieldKey, e.target.value)} />
      )}
    </div>
  );
}

function RenewalEditModal({ row, isAdmin, name, saving, message, onClose, onSave, onHistoryUpdated }) {
  const editableKeys = isAdmin ? [...RENEWAL_MANAGER_EDITABLE, ...RENEWAL_ADMIN_ONLY_EDITABLE] : RENEWAL_MANAGER_EDITABLE;
  const [form, setForm] = useState(() => {
    const init = {};
    for (const key of editableKeys) init[key] = row.values[key] || '';
    return init;
  });
  useEscapeKey(onClose);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const assignmentFields = RENEWAL_FIELDS.filter((f) =>
    RENEWAL_ADMIN_ONLY_EDITABLE.includes(f.key) && f.key !== 'manager'
  );
  const dealerFields = RENEWAL_FIELDS.filter((f) => RENEWAL_MANAGER_EDITABLE.includes(f.key));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-fixed">
          <div className="modal-header">
            <h2>{row.values.customerName}</h2>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>

          {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}

          <div className="modal-header-grid">
            <ReadOnlyField label="연락처" value={row.values.phone} />
            <ReadOnlyField label="차량번호" value={row.values.carNumber} />
            <ReadOnlyField label="갱신월" value={row.values.renewalMonth} />
            <ReadOnlyField label="만기일자" value={formatDateDisplay(row.values.expiryDate)} />
            <ReadOnlyField label="가입보험사" value={row.values.insurer} />
            <ReadOnlyField label="갱신담당매니저" value={row.values.manager} />
          </div>
        </div>

        <div className="modal-split-body">
          <div className="modal-main-col">
            {isAdmin && (
              <>
                <div className="modal-section-divider">배정 정보 (관리자 전용)</div>
                {assignmentFields.map((f) => (
                  <FieldInput key={f.key} fieldKey={f.key} value={form[f.key]} onChange={update} />
                ))}
              </>
            )}

            <div className="modal-section-divider">딜러 정보</div>
            {dealerFields.map((f) => (
              <FieldInput key={f.key} fieldKey={f.key} value={form[f.key]} onChange={update} />
            ))}

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>취소</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => onSave(form)}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>

          <div className="modal-side-col">
            <RenewalCallHistoryPanel row={row} onUpdated={onHistoryUpdated} />
          </div>
        </div>
      </div>
    </div>
  );
}

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

function RenewalCallHistoryPanel({ row, onUpdated }) {
  const [callHistory, setCallHistory] = useState(row.values.callHistory || '');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const notes = useMemo(() => parseContactHistory(callHistory), [callHistory]);

  async function submitNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/renewal/add-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowNumber: row.rowNumber, text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '저장에 실패했습니다.');
        setSaving(false);
        return;
      }
      setCallHistory(data.callHistory);
      setNoteText('');
      if (onUpdated) onUpdated(data.callHistory);
    } catch (e) {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="history-panel">
      <div className="history-section-title">통화이력</div>
      <div className="history-feed">
        {notes.length === 0 ? (
          <div className="history-empty">등록된 통화이력이 없습니다.</div>
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
          placeholder="통화 내용을 입력해주세요"
          onChange={(e) => setNoteText(e.target.value)}
        />
        <div className="history-add-footer">
          <span className="history-char-count">{noteText.length}/300자</span>
          <button className="btn btn-primary" disabled={saving || !noteText.trim()} onClick={submitNote}>
            {saving ? '저장 중...' : '통화이력 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}
