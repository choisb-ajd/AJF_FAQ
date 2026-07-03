import { useEffect, useState, useCallback } from 'react';
import { getEntry, fetchAndCache, mergeEntry } from '../lib/dataCache';

const LINKHUB_KEY = 'link-hub';

function CopyButton({ url }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [url]);
  return (
    <button type="button" className="linkhub-copy-btn" onClick={handleCopy} disabled={copied || !url}>
      {copied ? '복사됨 ✓' : '링크 복사'}
    </button>
  );
}

const SECTIONS = [
  { id: 'internal', title: '사내 업무 링크' },
  { id: 'insurer', title: '원수사별 링크' },
];

export default function LinkHub({ isAdmin }) {
  const initialLinkHub = getEntry(LINKHUB_KEY);
  const [internalLinks, setInternalLinks] = useState(() => (initialLinkHub ? initialLinkHub.data.internalLinks || [] : []));
  const [insurerLinks, setInsurerLinks] = useState(() => (initialLinkHub ? initialLinkHub.data.insurerLinks || [] : []));
  const [activeSection, setActiveSection] = useState('internal');
  const [loading, setLoading] = useState(() => !initialLinkHub);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? '' : t)), 2000);
  }

  useEffect(() => {
    if (getEntry(LINKHUB_KEY)) return;
    let alive = true;
    fetchAndCache(LINKHUB_KEY, '/api/link-hub')
      .then((data) => {
        if (!alive || !data) return;
        setInternalLinks(data.internalLinks || []);
        setInsurerLinks(data.insurerLinks || []);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  function updateInternalLinks(next) {
    setInternalLinks(next);
    mergeEntry(LINKHUB_KEY, { internalLinks: next });
  }

  function updateInsurerLinks(next) {
    setInsurerLinks(next);
    mergeEntry(LINKHUB_KEY, { insurerLinks: next });
  }

  if (loading) return <div className="loading-state">불러오는 중...</div>;
  if (error && internalLinks.length === 0 && insurerLinks.length === 0) {
    return <div className="error-state">{error}</div>;
  }

  return (
    <>
      {toast && <div className="app-toast">{toast}</div>}
      <div className="lms-wrap">
        <aside className="lms-sidebar">
          <div className="lms-sidebar-list">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`lms-sidebar-item${s.id === activeSection ? ' active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                <span>{s.title}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="lms-main">
          {activeSection === 'internal' ? (
            <InternalLinksPanel isAdmin={isAdmin} entries={internalLinks} setEntries={updateInternalLinks} showToast={showToast} />
          ) : (
            <InsurerLinksPanel isAdmin={isAdmin} entries={insurerLinks} setEntries={updateInsurerLinks} showToast={showToast} />
          )}
        </div>
      </div>
    </>
  );
}

function InternalLinksPanel({ isAdmin, entries, setEntries, showToast }) {
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newDetail, setNewDetail] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editCategory, setEditCategory] = useState('');
  const [editDetail, setEditDetail] = useState('');

  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState('');

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setNewCategory('');
    setNewDetail('');
    setRowError('');
  }

  function cancelAdd() {
    setAdding(false);
    setRowError('');
  }

  async function submitAdd() {
    const category = newCategory.trim();
    if (!category) {
      setRowError('구분을 입력해주세요.');
      return;
    }
    setSaving(true);
    setRowError('');
    try {
      const res = await fetch('/api/link-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addInternalLink', category, detail: newDetail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추가하지 못했습니다.');
      setEntries(data.internalLinks);
      setAdding(false);
      setNewCategory('');
      setNewDetail('');
      showToast('완료 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(entry) {
    setAdding(false);
    setEditingId(entry.id);
    setEditCategory(entry.category || '');
    setEditDetail(entry.detail || '');
    setRowError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError('');
  }

  async function saveEdit() {
    const category = editCategory.trim();
    if (!category) {
      setRowError('구분을 입력해주세요.');
      return;
    }
    setSaving(true);
    setRowError('');
    try {
      const res = await fetch('/api/link-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateInternalLink', id: editingId, category, detail: editDetail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setEntries(data.internalLinks);
      setEditingId(null);
      showToast('수정 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry) {
    if (!window.confirm('이 항목을 삭제하시겠습니까?')) return;
    setRowError('');
    try {
      const res = await fetch('/api/link-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteInternalLink', id: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제하지 못했습니다.');
      setEntries(data.internalLinks);
      if (editingId === entry.id) setEditingId(null);
      showToast('삭제 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    }
  }

  return (
    <>
      <div className="lms-main-head">
        <h2>사내 업무 링크</h2>
        {isAdmin && !adding && (
          <div className="lms-main-head-actions">
            <button type="button" className="btn btn-primary" onClick={startAdd}>+ 항목 등록</button>
          </div>
        )}
      </div>

      {rowError && <div className="error-state lms-inline-error">{rowError}</div>}

      <div className="table-wrap linkhub-table-wrap">
        <table className="linkhub-table">
          <thead>
            <tr>
              <th className="linkhub-col-num">번호</th>
              <th className="linkhub-col-category">구분</th>
              <th>상세</th>
              {isAdmin && <th className="linkhub-col-actions">관리</th>}
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr>
                <td className="linkhub-col-num">-</td>
                <td>
                  <input
                    autoFocus
                    className="linkhub-edit-input"
                    placeholder="구분"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  />
                </td>
                <td>
                  <textarea
                    className="linkhub-edit-textarea"
                    placeholder="상세 내용"
                    value={newDetail}
                    onChange={(e) => setNewDetail(e.target.value)}
                  />
                </td>
                <td className="linkhub-row-actions">
                  <button type="button" className="btn" onClick={cancelAdd} disabled={saving}>취소</button>
                  <button type="button" className="btn btn-primary" onClick={submitAdd} disabled={saving}>
                    {saving ? '저장 중...' : '추가'}
                  </button>
                </td>
              </tr>
            )}
            {entries.length === 0 && !adding ? (
              <tr className="empty-row">
                <td colSpan={isAdmin ? 4 : 3}>등록된 항목이 없습니다.</td>
              </tr>
            ) : (
              entries.map((entry, i) => {
                const isEditing = editingId === entry.id;
                return (
                  <tr key={entry.id}>
                    <td className="linkhub-col-num">{i + 1}</td>
                    <td>
                      {isEditing ? (
                        <input
                          autoFocus
                          className="linkhub-edit-input"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                        />
                      ) : (
                        entry.category
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <textarea
                          className="linkhub-edit-textarea"
                          value={editDetail}
                          onChange={(e) => setEditDetail(e.target.value)}
                        />
                      ) : (
                        <div className="linkhub-detail-text">
                          {entry.detail || <span className="notepad-empty">내용 없음</span>}
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="linkhub-row-actions">
                        {isEditing ? (
                          <>
                            <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>취소</button>
                            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                              {saving ? '저장 중...' : '저장'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-primary" onClick={() => startEdit(entry)}>수정</button>
                            <button type="button" className="btn btn-danger" onClick={() => deleteEntry(entry)}>삭제</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function emptyInsurerForm() {
  return { insurer: '', tmNumber: '', cmUrlPc: '', cmUrlMobile: '', note: '', remark: '' };
}

function InsurerLinksPanel({ isAdmin, entries, setEntries, showToast }) {
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState(emptyInsurerForm());

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyInsurerForm());

  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState('');

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setNewForm(emptyInsurerForm());
    setRowError('');
  }

  function cancelAdd() {
    setAdding(false);
    setRowError('');
  }

  async function submitAdd() {
    const insurer = newForm.insurer.trim();
    if (!insurer) {
      setRowError('원수사를 입력해주세요.');
      return;
    }
    setSaving(true);
    setRowError('');
    try {
      const res = await fetch('/api/link-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addInsurerLink', ...newForm, insurer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추가하지 못했습니다.');
      setEntries(data.insurerLinks);
      setAdding(false);
      setNewForm(emptyInsurerForm());
      showToast('완료 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(entry) {
    setAdding(false);
    setEditingId(entry.id);
    setEditForm({
      insurer: entry.insurer || '',
      tmNumber: entry.tmNumber || '',
      cmUrlPc: entry.cmUrlPc || '',
      cmUrlMobile: entry.cmUrlMobile || '',
      note: entry.note || '',
      remark: entry.remark || '',
    });
    setRowError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError('');
  }

  async function saveEdit() {
    const insurer = editForm.insurer.trim();
    if (!insurer) {
      setRowError('원수사를 입력해주세요.');
      return;
    }
    setSaving(true);
    setRowError('');
    try {
      const res = await fetch('/api/link-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateInsurerLink', id: editingId, ...editForm, insurer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setEntries(data.insurerLinks);
      setEditingId(null);
      showToast('수정 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry) {
    if (!window.confirm('이 항목을 삭제하시겠습니까?')) return;
    setRowError('');
    try {
      const res = await fetch('/api/link-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteInsurerLink', id: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제하지 못했습니다.');
      setEntries(data.insurerLinks);
      if (editingId === entry.id) setEditingId(null);
      showToast('삭제 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    }
  }

  function renderUrlCell(entry) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: '#F4F8FF', borderRadius: 6, border: '1px solid #D6E6FF' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2a5ab7', marginBottom: 2 }}>🖥 PC</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {entry.cmUrlPc ? (
              <>
                <a href={entry.cmUrlPc} target="_blank" rel="noreferrer" className="linkhub-url-row" style={{ margin: 0 }}>바로가기</a>
                <CopyButton url={entry.cmUrlPc} />
              </>
            ) : (
              <span className="notepad-empty">미등록</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', background: '#F3FBF6', borderRadius: 6, border: '1px solid #C3EDD5' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1a7f4a', marginBottom: 2 }}>📱 모바일</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {entry.cmUrlMobile ? (
              <>
                <a href={entry.cmUrlMobile} target="_blank" rel="noreferrer" className="linkhub-url-row" style={{ margin: 0 }}>바로가기</a>
                <CopyButton url={entry.cmUrlMobile} />
              </>
            ) : (
              <span className="notepad-empty">미등록</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderUrlEdit(form, setForm) {
    return (
      <>
        <div className="linkhub-url-row">
          <span className="linkhub-url-label">PC</span>
          <input
            className="linkhub-edit-input"
            placeholder="PC용 URL"
            value={form.cmUrlPc}
            onChange={(e) => setForm((f) => ({ ...f, cmUrlPc: e.target.value }))}
          />
        </div>
        <div className="linkhub-url-row">
          <span className="linkhub-url-label">모바일</span>
          <input
            className="linkhub-edit-input"
            placeholder="모바일용 URL"
            value={form.cmUrlMobile}
            onChange={(e) => setForm((f) => ({ ...f, cmUrlMobile: e.target.value }))}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="lms-main-head">
        <h2>원수사별 링크</h2>
        {isAdmin && !adding && (
          <div className="lms-main-head-actions">
            <button type="button" className="btn btn-primary" onClick={startAdd}>+ 항목 등록</button>
          </div>
        )}
      </div>

      {rowError && <div className="error-state lms-inline-error">{rowError}</div>}

      <div className="table-wrap linkhub-table-wrap">
        <table className="linkhub-table linkhub-insurer-table">
          <thead>
            <tr>
              <th className="linkhub-col-num">번호</th>
              <th className="linkhub-col-insurer">원수사</th>
              <th className="linkhub-col-tm">TM호전환 번호</th>
              <th className="linkhub-col-url">CM URL</th>
              <th>비고</th>
              <th>특이사항</th>
              {isAdmin && <th className="linkhub-col-actions">관리</th>}
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr>
                <td className="linkhub-col-num">-</td>
                <td>
                  <input
                    autoFocus
                    className="linkhub-edit-input"
                    placeholder="원수사"
                    value={newForm.insurer}
                    onChange={(e) => setNewForm((f) => ({ ...f, insurer: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="linkhub-edit-input"
                    placeholder="TM호전환 번호"
                    value={newForm.tmNumber}
                    onChange={(e) => setNewForm((f) => ({ ...f, tmNumber: e.target.value }))}
                  />
                </td>
                <td>{renderUrlEdit(newForm, setNewForm)}</td>
                <td>
                  <textarea
                    className="linkhub-edit-textarea"
                    placeholder="비고"
                    value={newForm.note}
                    onChange={(e) => setNewForm((f) => ({ ...f, note: e.target.value }))}
                  />
                </td>
                <td>
                  <textarea
                    className="linkhub-edit-textarea"
                    placeholder="특이사항"
                    value={newForm.remark}
                    onChange={(e) => setNewForm((f) => ({ ...f, remark: e.target.value }))}
                  />
                </td>
                <td className="linkhub-row-actions">
                  <button type="button" className="btn" onClick={cancelAdd} disabled={saving}>취소</button>
                  <button type="button" className="btn btn-primary" onClick={submitAdd} disabled={saving}>
                    {saving ? '저장 중...' : '추가'}
                  </button>
                </td>
              </tr>
            )}
            {entries.length === 0 && !adding ? (
              <tr className="empty-row">
                <td colSpan={isAdmin ? 7 : 6}>등록된 항목이 없습니다.</td>
              </tr>
            ) : (
              entries.map((entry, i) => {
                const isEditing = editingId === entry.id;
                return (
                  <tr key={entry.id}>
                    <td className="linkhub-col-num">{i + 1}</td>
                    <td>
                      {isEditing ? (
                        <input
                          autoFocus
                          className="linkhub-edit-input"
                          value={editForm.insurer}
                          onChange={(e) => setEditForm((f) => ({ ...f, insurer: e.target.value }))}
                        />
                      ) : (
                        entry.insurer
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          className="linkhub-edit-input"
                          value={editForm.tmNumber}
                          onChange={(e) => setEditForm((f) => ({ ...f, tmNumber: e.target.value }))}
                        />
                      ) : (
                        entry.tmNumber || <span className="notepad-empty">미등록</span>
                      )}
                    </td>
                    <td>{isEditing ? renderUrlEdit(editForm, setEditForm) : renderUrlCell(entry)}</td>
                    <td>
                      {isEditing ? (
                        <textarea
                          className="linkhub-edit-textarea"
                          value={editForm.note}
                          onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                        />
                      ) : (
                        <div className="linkhub-detail-text">{entry.note || <span className="notepad-empty">-</span>}</div>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <textarea
                          className="linkhub-edit-textarea"
                          value={editForm.remark}
                          onChange={(e) => setEditForm((f) => ({ ...f, remark: e.target.value }))}
                        />
                      ) : (
                        <div className="linkhub-detail-text">{entry.remark || <span className="notepad-empty">-</span>}</div>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="linkhub-row-actions">
                        {isEditing ? (
                          <>
                            <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>취소</button>
                            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                              {saving ? '저장 중...' : '저장'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-primary" onClick={() => startEdit(entry)}>수정</button>
                            <button type="button" className="btn btn-danger" onClick={() => deleteEntry(entry)}>삭제</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
