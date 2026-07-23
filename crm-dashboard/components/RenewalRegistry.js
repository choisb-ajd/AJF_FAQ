import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RENEWAL_FIELDS,
  RENEWAL_MANAGER_EDITABLE,
  RENEWAL_ADMIN_ONLY_EDITABLE,
  formatDateDisplay,
  parseContactHistory,
} from '../lib/sheetSchema';
import useEscapeKey from '../lib/useEscapeKey';
import { getEntry, fetchAndCache, mergeEntry } from '../lib/dataCache';

const FIELD_META = Object.fromEntries(RENEWAL_FIELDS.map((f) => [f.key, f]));
const DATE_KEYS = ['assignedDate', 'expiryDate', 'dealerLastContractDate'];
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

function extractYearMonth(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  const iso4 = s.match(/^(\d{4})-(\d{2})/);
  if (iso4) return `${iso4[1]}-${iso4[2]}`;
  const kor = s.match(/^(\d{4})\.\s*(\d{1,2})/);
  if (kor) return `${kor[1]}-${String(kor[2]).padStart(2, '0')}`;
  const iso2 = s.match(/^(\d{2})-(\d{2})/);
  if (iso2) return `20${iso2[1]}-${iso2[2]}`;
  return '';
}

const TABLE_COLUMNS = [
  { key: 'renewalMonth', label: '갱신월' },
  { key: 'manager', label: '갱신담당매니저' },
  { key: 'customerName', label: '고객명' },
  { key: 'residentNumber', label: '주민번호' },
  { key: 'phone', label: '연락처' },
  { key: 'expiryDate', label: '만기일자' },
  { key: 'insurer', label: '가입보험사' },
  { key: 'callHistory', label: '컨택 히스토리' },
];

const FROZEN_KEYS = ['renewalMonth', 'manager', 'customerName'];
const FROZEN_KEY_SET = new Set(FROZEN_KEYS);

const DEFAULT_COL_WIDTHS = {
  renewalMonth: 80,
  manager: 120,
  customerName: 100,
  residentNumber: 120,
  phone: 130,
  expiryDate: 110,
  insurer: 120,
  callHistory: 260,
};
const DEFAULT_COL_WIDTH = 100;
const MIN_COL_WIDTH = 50;

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

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓' : '복사'}
    </button>
  );
}

function getNoteClasses(text) {
  const t = (text || '').replace(/\s/g, '');
  if (t.includes('계약완료') || t.includes('체결완료')) return 'note-kw-contract';
  if (t.includes('타사가입')) return 'note-kw-other';
  if (t.includes('명의이전')) return 'note-kw-transfer';
  return '';
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

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const RENEWAL_KEY = 'renewal';

export default function RenewalRegistry({ isAdmin, name, onPanelChange }) {
  const initialRenewal = getEntry(RENEWAL_KEY);
  const [rows, setRows] = useState(() => (initialRenewal ? initialRenewal.data.rows || [] : []));
  const [loading, setLoading] = useState(() => !initialRenewal);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [expiryMonthFilters, setExpiryMonthFilters] = useState(() => new Set());
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const monthDropdownRef = useRef(null);
  const [recent60dFilter, setRecent60dFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [gotoInput, setGotoInput] = useState('');
  const [sortKey, setSortKey] = useState('expiryDate');
  const [sortDir, setSortDir] = useState('asc');
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [focusNote, setFocusNote] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  async function fetchRows({ silent = false, force = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await fetchAndCache(RENEWAL_KEY, '/api/renewal', { force });
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
      mergeEntry(RENEWAL_KEY, { rows: next });
      return next;
    });
  }

  async function handleManualRefresh() {
    await fetchRows({ force: true });
    setRefreshTick((t) => t + 1);
  }

  useEffect(() => {
    if (!getEntry(RENEWAL_KEY)) {
      fetchRows();
    }
  }, []);

  useEffect(() => {
    if (editing) return;
    const entry = getEntry(RENEWAL_KEY);
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

  const managers = useMemo(() => {
    const set = new Set(rows.map((r) => r.values.manager).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const expiryMonths = useMemo(() => {
    const set = new Set(rows.map((r) => extractYearMonth(r.values.expiryDate)).filter(Boolean));
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
      if (expiryMonthFilters.size > 0 && !expiryMonthFilters.has(extractYearMonth(v.expiryDate || ''))) return false;
      if (recent60dFilter && (v.dealerRecent60d || '').toUpperCase() !== recent60dFilter) return false;
      return true;
    });
  }, [rows, search, managerFilter, expiryMonthFilters, recent60dFilter, isAdmin]);

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

  useEffect(() => { setPage(1); }, [search, managerFilter, expiryMonthFilters, recent60dFilter, pageSize]);

  useEffect(() => {
    if (!showMonthDropdown) return;
    function handler(e) {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(e.target)) {
        setShowMonthDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMonthDropdown]);

  function gotoPage() {
    const n = parseInt(gotoInput, 10);
    if (!n || n < 1 || n > totalPages) return;
    setPage(n);
    setGotoInput('');
  }

  function resetFilters() {
    setSearch('');
    setManagerFilter('');
    setExpiryMonthFilters(new Set());
    setRecent60dFilter('');
    setShowMonthDropdown(false);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function startColumnResize(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[key] || DEFAULT_COL_WIDTH;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    function onMouseMove(ev) {
      setColWidths((prev) => ({ ...prev, [key]: Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX)) }));
    }
    function onMouseUp() {
      document.body.style.userSelect = prevUserSelect;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function openEdit(row, withFocusNote = false) {
    setEditing(row);
    setFocusNote(withFocusNote);
    setSaveMsg(null);
    if (onPanelChange) onPanelChange(true);
  }

  function closeEdit() {
    setEditing(null);
    setFocusNote(false);
    if (onPanelChange) onPanelChange(false);
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

  const frozenLefts = useMemo(() => {
    const result = {};
    let acc = 0;
    for (const key of FROZEN_KEYS) {
      result[key] = acc;
      acc += colWidths[key] || DEFAULT_COL_WIDTH;
    }
    return result;
  }, [colWidths]);

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
        <div className="filter-field" ref={monthDropdownRef} style={{ position: 'relative' }}>
          <label>만기월</label>
          <button className="multi-select-btn" onClick={() => setShowMonthDropdown((v) => !v)}>
            {expiryMonthFilters.size === 0 ? '전체' : `${expiryMonthFilters.size}개월 선택됨`}
            <span style={{ fontSize: 10 }}>▾</span>
          </button>
          {showMonthDropdown && (
            <div className="multi-select-dropdown">
              <div className="multi-select-ctrl">
                <button onClick={() => setExpiryMonthFilters(new Set(expiryMonths))}>전체 선택</button>
                <button onClick={() => setExpiryMonthFilters(new Set())}>초기화</button>
              </div>
              <div className="multi-select-list">
                {expiryMonths.map((m) => (
                  <label key={m} className="multi-select-item">
                    <input
                      type="checkbox"
                      checked={expiryMonthFilters.has(m)}
                      onChange={() => {
                        setExpiryMonthFilters((prev) => {
                          const next = new Set(prev);
                          if (next.has(m)) next.delete(m);
                          else next.add(m);
                          return next;
                        });
                      }}
                    />
                    <span>{m}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
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
          {isAdmin && (
            <button
              className="btn"
              disabled={importing}
              onClick={async () => {
                setImporting(true);
                setImportMsg('');
                try {
                  const res = await fetch('/api/renewal/import-manager-notes', { method: 'POST' });
                  const data = await res.json();
                  if (!res.ok) {
                    setImportMsg(`오류: ${data.error || '가져오기 실패'}`);
                  } else {
                    const parts = [];
                    if (data.imported > 0) parts.push(`${data.imported}건 추가`);
                    if (data.converted > 0) parts.push(`${data.converted}행 형식변환`);
                    setImportMsg(parts.length > 0 ? `완료: ${parts.join(', ')} (${data.rowsUpdated}행 업데이트)` : '완료: 새로 반영할 내용 없음');
                    await fetchRows({ force: true });
                  }
                } catch {
                  setImportMsg('네트워크 오류가 발생했습니다.');
                } finally {
                  setImporting(false);
                }
              }}
            >
              {importing ? '가져오는 중...' : '히스토리 가져오기'}
            </button>
          )}
        </div>
        {importMsg && <div style={{ fontSize: 12, color: importMsg.startsWith('오류') ? 'var(--red)' : 'var(--green)', marginTop: 4 }}>{importMsg}</div>}
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
              <colgroup>
                {TABLE_COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: colWidths[c.key] || DEFAULT_COL_WIDTH }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((c) => {
                    const isFrozen = FROZEN_KEY_SET.has(c.key);
                    return (
                      <th
                        key={c.key}
                        onClick={() => c.key !== 'callHistory' && toggleSort(c.key)}
                        style={{
                          cursor: c.key !== 'callHistory' ? 'pointer' : 'default',
                          ...(isFrozen ? { position: 'sticky', left: frozenLefts[c.key], zIndex: 6, background: '#FAFBFD' } : {}),
                        }}
                      >
                        {c.label}
                        {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        {c.key !== 'callHistory' && (
                          <span
                            className="col-resize-handle"
                            onMouseDown={(e) => startColumnResize(e, c.key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={TABLE_COLUMNS.length}>검색 결과가 없습니다.</td>
                  </tr>
                ) : (
                  paged.map((row) => (
                    <tr
                      key={row.rowNumber}
                      onClick={() => openEdit(row)}
                      className={editing && editing.rowNumber === row.rowNumber ? 'row-selected' : ''}
                    >
                      {TABLE_COLUMNS.map((c) => {
                        const isFrozen = FROZEN_KEY_SET.has(c.key);

                        if (c.key === 'callHistory') {
                          const notes = parseContactHistory(row.values.callHistory);
                          const latest = notes[0];
                          const latestText = latest ? latest.text : '';
                          const latestAuthor = latest ? latest.author : '';
                          const tooltipText = latest
                            ? `[${formatRelativeTime(latest.timestamp)} · ${latestAuthor || ''}]\n${latestText}`
                            : '';
                          const authorPrefix = latestAuthor ? `[${latestAuthor}] ` : '';
                          const combined = latestText ? authorPrefix + latestText : '';
                          const displayText = combined.length > 55 ? combined.slice(0, 55) + '…' : combined;
                          return (
                            <td key="callHistory">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="history-snippet" title={tooltipText || undefined}>
                                  {displayText || <span style={{ color: '#C2C7CC' }}>-</span>}
                                </span>
                                <button
                                  className="btn-add-note"
                                  title="메모 추가"
                                  onClick={(e) => { e.stopPropagation(); openEdit(row, true); }}
                                >+</button>
                              </div>
                            </td>
                          );
                        }

                        const val = row.values[c.key];
                        const rawDisplay = DATE_KEYS.includes(c.key) ? formatDateDisplay(val) : val;
                        let display = rawDisplay;
                        if (c.key === 'residentNumber') display = maskResidentNumber(val);
                        else if (c.key === 'phone') display = maskPhone(val);
                        const showCopy = (c.key === 'residentNumber' || c.key === 'phone') && val;
                        return (
                          <td
                            key={c.key}
                            title={!showCopy ? rawDisplay : undefined}
                            className={isFrozen ? 'frozen-cell' : undefined}
                            style={isFrozen ? { position: 'sticky', left: frozenLefts[c.key], zIndex: 1 } : undefined}
                          >
                            {showCopy ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>{display}</span>
                                <CopyButton value={val} />
                              </div>
                            ) : (display || '-')}
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
        <RenewalDetailPanel
          key={editing.rowNumber}
          row={editing}
          isAdmin={isAdmin}
          saving={saving}
          message={saveMsg}
          focusNote={focusNote}
          onClose={closeEdit}
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

function RenewalDetailPanel({ row, isAdmin, saving, message, focusNote, onClose, onSave, onHistoryUpdated }) {
  const editableKeys = isAdmin
    ? [...RENEWAL_MANAGER_EDITABLE, ...RENEWAL_ADMIN_ONLY_EDITABLE]
    : RENEWAL_MANAGER_EDITABLE;
  const [form, setForm] = useState(() => {
    const init = {};
    for (const key of editableKeys) init[key] = row.values[key] || '';
    return init;
  });
  useEscapeKey(onClose);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const assignmentFields = RENEWAL_FIELDS.filter(
    (f) => RENEWAL_ADMIN_ONLY_EDITABLE.includes(f.key) && f.key !== 'manager'
  );
  const dealerFields = RENEWAL_FIELDS.filter((f) => RENEWAL_MANAGER_EDITABLE.includes(f.key));

  return (
    <div className="detail-side-panel">
      <div className="detail-panel-header">
        <h2>{row.values.customerName}</h2>
        <button className="modal-close" onClick={onClose}>&times;</button>
      </div>

      <div className="detail-panel-history">
        <RenewalContactHistoryPanel row={row} focusNote={focusNote} onUpdated={onHistoryUpdated} />
      </div>

      <div className="detail-panel-body">
        {message && <div className={`modal-message ${message.type}`}>{message.text}</div>}

        <div className="modal-header-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 14px', marginBottom: 4 }}>
          <ReadOnlyField label="연락처" value={row.values.phone} />
          <ReadOnlyField label="차량번호" value={row.values.carNumber} />
          <ReadOnlyField label="갱신월" value={row.values.renewalMonth} />
          <ReadOnlyField label="만기일자" value={formatDateDisplay(row.values.expiryDate)} />
          <ReadOnlyField label="가입보험사" value={row.values.insurer} />
          <ReadOnlyField label="갱신담당매니저" value={row.values.manager} />
          <ReadOnlyField label="딜러연락처" value={row.values.dealerContact} />
          <ReadOnlyField label="딜러이름" value={row.values.dealerName} />
          <ReadOnlyField label="딜러유형" value={row.values.dealerType} />
        </div>

        <CollapsibleSection title="딜러 정보" defaultOpen>
          {dealerFields.map((f) => (
            <FieldInput key={f.key} fieldKey={f.key} value={form[f.key]} onChange={update} />
          ))}
        </CollapsibleSection>

        {isAdmin && (
          <CollapsibleSection title="배정 정보 (관리자 전용)">
            {assignmentFields.map((f) => (
              <FieldInput key={f.key} fieldKey={f.key} value={form[f.key]} onChange={update} />
            ))}
          </CollapsibleSection>
        )}
      </div>

      <div className="detail-panel-footer">
        <button className="btn" onClick={onClose}>닫기</button>
        <button className="btn btn-primary" disabled={saving} onClick={() => onSave(form)}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

function RenewalContactHistoryPanel({ row, focusNote, onUpdated }) {
  const [callHistory, setCallHistory] = useState(row.values.callHistory || '');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);

  const notes = useMemo(() => parseContactHistory(callHistory), [callHistory]);

  useEffect(() => {
    if (focusNote && textareaRef.current) textareaRef.current.focus();
  }, [focusNote]);

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
      <div className="history-section-title">컨택 히스토리</div>

      <div className="history-add-box">
        {error && <div className="modal-message err">{error}</div>}
        <textarea
          ref={textareaRef}
          value={noteText}
          maxLength={300}
          placeholder="상담 내용 입력 (Ctrl+Enter 저장)"
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submitNote();
            }
          }}
        />
        <div className="history-add-footer">
          <span className="history-char-count">{noteText.length}/300자</span>
          <button className="btn btn-primary" disabled={saving || !noteText.trim()} onClick={submitNote}>
            {saving ? '저장 중...' : '메모 추가'}
          </button>
        </div>
      </div>

      <div className="history-feed">
        {notes.length === 0 ? (
          <div className="history-empty">등록된 메모가 없습니다.</div>
        ) : (
          notes.map((n, i) => (
            <div className={`history-note ${getNoteClasses(n.text)}`} key={i}>
              <div className="history-note-meta">
                {n.author && <span className="history-note-author">{n.author}</span>}
                {n.timestamp && <span className="history-note-time">{formatRelativeTime(n.timestamp)}</span>}
              </div>
              <div className="history-note-text">{n.text}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
