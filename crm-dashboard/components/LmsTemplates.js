import { useEffect, useState } from 'react';

export default function LmsTemplates({ isAdmin }) {
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryTitle, setNewCategoryTitle] = useState('');
  const [categoryError, setCategoryError] = useState('');

  const [renamingCategoryId, setRenamingCategoryId] = useState(null);
  const [renameCategoryTitle, setRenameCategoryTitle] = useState('');

  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [copyMsgId, setCopyMsgId] = useState('');
  const [toast, setToast] = useState('');

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? '' : t)), 2000);
  }

  useEffect(() => {
    let alive = true;
    fetch('/api/lms-templates')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '불러오지 못했습니다.');
        return data;
      })
      .then((data) => {
        if (!alive) return;
        const cats = data.categories || [];
        setCategories(cats);
        setEntries(data.entries || []);
        if (cats.length > 0) setActiveCategoryId(cats[0].id);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const activeCategory = categories.find((c) => c.id === activeCategoryId) || null;
  const categoryEntries = entries.filter((e) => e.categoryId === activeCategoryId);
  const adminEntries = categoryEntries.filter((e) => e.isAdminTemplate);
  const regularEntries = categoryEntries.filter((e) => !e.isAdminTemplate);

  function countFor(categoryId) {
    return entries.filter((e) => e.categoryId === categoryId).length;
  }

  function confirmDiscardIfEditing() {
    if (!editingEntryId) return true;
    const target = entries.find((e) => e.id === editingEntryId);
    if (target && editContent === (target.content || '')) return true;
    return window.confirm('저장하지 않은 수정 내용이 있습니다. 이동하시겠습니까?');
  }

  function selectCategory(id) {
    if (id === activeCategoryId) return;
    if (!confirmDiscardIfEditing()) return;
    setActiveCategoryId(id);
    setEditingEntryId(null);
    setEntryError('');
    setCopyMsgId('');
  }

  function startEdit(entry) {
    if (editingEntryId && editingEntryId !== entry.id && !confirmDiscardIfEditing()) return;
    setEntryError('');
    setEditingEntryId(entry.id);
    setEditContent(entry.content || '');
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setEntryError('');
  }

  async function saveEdit() {
    if (!editingEntryId) return;
    setSaving(true);
    setEntryError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateEntry', id: editingEntryId, content: editContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setEntries(data.entries);
      setEditingEntryId(null);
      showToast('수정 되었습니다.');
    } catch (e) {
      setEntryError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function addEntry(isAdminTemplate) {
    if (!activeCategoryId) return;
    if (!confirmDiscardIfEditing()) return;
    setEntryError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addEntry', categoryId: activeCategoryId, content: '', isAdminTemplate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추가하지 못했습니다.');
      setEntries(data.entries);
      const created = data.entries[data.entries.length - 1];
      setEditingEntryId(created.id);
      setEditContent('');
      showToast('완료 되었습니다.');
    } catch (e) {
      setEntryError(e.message);
    }
  }

  async function deleteEntry(entry) {
    if (!window.confirm('이 템플릿을 삭제하시겠습니까?')) return;
    setEntryError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteEntry', id: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제하지 못했습니다.');
      setEntries(data.entries);
      if (editingEntryId === entry.id) setEditingEntryId(null);
      showToast('삭제 되었습니다.');
    } catch (e) {
      setEntryError(e.message);
    }
  }

  async function handleCopy(entry) {
    if (!entry.content) return;
    try {
      await navigator.clipboard.writeText(entry.content);
      setCopyMsgId(entry.id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = entry.content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopyMsgId(entry.id);
      } catch {
        setCopyMsgId(`${entry.id}:fail`);
      }
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopyMsgId(''), 2000);
  }

  async function submitAddCategory() {
    const title = newCategoryTitle.trim();
    if (!title) {
      setCategoryError('카테고리 이름을 입력해주세요.');
      return;
    }
    setCategoryError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addCategory', title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추가하지 못했습니다.');
      setCategories(data.categories);
      const created = data.categories[data.categories.length - 1];
      setActiveCategoryId(created.id);
      setAddingCategory(false);
      setNewCategoryTitle('');
      showToast('완료 되었습니다.');
    } catch (e) {
      setCategoryError(e.message);
    }
  }

  function startRenameCategory(c) {
    setRenamingCategoryId(c.id);
    setRenameCategoryTitle(c.title);
    setCategoryError('');
  }

  async function submitRenameCategory() {
    const title = renameCategoryTitle.trim();
    if (!title) { setCategoryError('카테고리 이름을 입력해주세요.'); return; }
    setCategoryError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'renameCategory', id: renamingCategoryId, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '수정하지 못했습니다.');
      setCategories(data.categories);
      setRenamingCategoryId(null);
      showToast('수정 되었습니다.');
    } catch (e) {
      setCategoryError(e.message);
    }
  }

  async function deleteCategory(c) {
    const entryCount = entries.filter((e) => e.categoryId === c.id).length;
    const msg = entryCount > 0
      ? `"${c.title}" 카테고리를 삭제하면 포함된 템플릿 ${entryCount}개도 함께 삭제됩니다. 삭제하시겠습니까?`
      : `"${c.title}" 카테고리를 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;
    setCategoryError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteCategory', id: c.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제하지 못했습니다.');
      setCategories(data.categories);
      setEntries(data.entries);
      if (activeCategoryId === c.id) {
        setActiveCategoryId(data.categories.length > 0 ? data.categories[0].id : null);
        setEditingEntryId(null);
      }
      showToast('삭제 되었습니다.');
    } catch (e) {
      setCategoryError(e.message);
    }
  }

  if (loading) return <div className="loading-state">불러오는 중...</div>;
  if (error && categories.length === 0) return <div className="error-state">{error}</div>;

  function renderEntryCard(entry) {
    const isEditing = editingEntryId === entry.id;
    const canEdit = isAdmin || !entry.isAdminTemplate;
    return (
      <div key={entry.id} className={`lms-card${entry.isAdminTemplate ? ' admin' : ''}`}>
        <div className="lms-card-head">
          {entry.isAdminTemplate && <span className="lms-admin-badge">관리자 등록 템플릿</span>}
          {entry.updatedAt && (
            <span className="lms-entry-meta">
              {entry.updatedBy ? `${entry.updatedBy} · ` : ''}{entry.updatedAt}
            </span>
          )}
        </div>

        {isEditing ? (
          <>
            <textarea
              className="lms-editor"
              autoFocus
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="문자 내용을 입력하세요. 줄바꿈은 그대로 저장됩니다."
            />
            <div className="lms-editor-foot">
              <span className="lms-char-count">{editContent.length}자</span>
              <div className="lms-editor-actions">
                <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>취소</button>
                <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="lms-preview">
            <div className="lms-preview-label">문자 미리보기</div>
            <div className="lms-preview-bubble">
              {entry.content || <span className="notepad-empty">아직 내용이 없습니다. 수정 버튼을 눌러 작성해보세요.</span>}
            </div>
          </div>
        )}

        {!isEditing && (
          <div className="lms-card-footer">
            {copyMsgId === entry.id && <span className="lms-copy-msg">복사되었습니다.</span>}
            {copyMsgId === `${entry.id}:fail` && <span className="lms-copy-msg fail">복사에 실패했습니다.</span>}
            <button type="button" className="btn" onClick={() => handleCopy(entry)} disabled={!entry.content}>
              복사
            </button>
            {canEdit && (
              <button type="button" className="btn btn-primary" onClick={() => startEdit(entry)}>수정</button>
            )}
            {canEdit && (
              <button type="button" className="btn btn-danger" onClick={() => deleteEntry(entry)}>삭제</button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {toast && <div className="app-toast">{toast}</div>}
      <div className="lms-wrap">
      <aside className="lms-sidebar">
        <div className="lms-sidebar-list">
          {categories.map((c) => (
            <div key={c.id} className={`lms-sidebar-item-wrap${c.id === activeCategoryId ? ' active' : ''}`}>
              {renamingCategoryId === c.id ? (
                <div className="lms-sidebar-rename-form">
                  <input
                    autoFocus
                    value={renameCategoryTitle}
                    onChange={(e) => setRenameCategoryTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRenameCategory();
                      if (e.key === 'Escape') { setRenamingCategoryId(null); setCategoryError(''); }
                    }}
                  />
                  <div className="lms-sidebar-rename-actions">
                    <button type="button" className="btn btn-primary btn-xs" onClick={submitRenameCategory}>저장</button>
                    <button type="button" className="btn btn-xs" onClick={() => { setRenamingCategoryId(null); setCategoryError(''); }}>취소</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="lms-sidebar-item"
                  onClick={() => selectCategory(c.id)}
                >
                  <span className="lms-sidebar-item-title">{c.title}</span>
                  {countFor(c.id) > 0 && <span className="lms-sidebar-count">{countFor(c.id)}</span>}
                </button>
              )}
              {renamingCategoryId !== c.id && (
                <div className="lms-sidebar-item-actions">
                  <button type="button" className="lms-cat-action-btn" title="이름 수정" onClick={(e) => { e.stopPropagation(); startRenameCategory(c); }}>✎</button>
                  <button type="button" className="lms-cat-action-btn danger" title="삭제" onClick={(e) => { e.stopPropagation(); deleteCategory(c); }}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {categoryError && <div className="error-state lms-inline-error">{categoryError}</div>}
        {addingCategory ? (
          <div className="lms-sidebar-add-form">
            <input
              autoFocus
              placeholder="카테고리 이름"
              value={newCategoryTitle}
              onChange={(e) => setNewCategoryTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAddCategory();
                if (e.key === 'Escape') {
                  setAddingCategory(false);
                  setNewCategoryTitle('');
                  setCategoryError('');
                }
              }}
            />
            <div className="lms-sidebar-add-actions">
              <button type="button" className="btn btn-primary" onClick={submitAddCategory}>추가</button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategoryTitle('');
                  setCategoryError('');
                }}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="lms-sidebar-add" onClick={() => setAddingCategory(true)}>+ 카테고리 등록</button>
        )}
      </aside>

      <div className="lms-main">
        {activeCategory ? (
          <>
            <div className="lms-main-head">
              <h2>{activeCategory.title}</h2>
              <div className="lms-main-head-actions">
                <button type="button" className="btn btn-primary" onClick={() => addEntry(false)}>+ 템플릿 추가</button>
                {isAdmin && (
                  <button type="button" className="btn btn-admin" onClick={() => addEntry(true)}>+ 관리자 템플릿 등록</button>
                )}
              </div>
            </div>

            {entryError && <div className="error-state lms-inline-error">{entryError}</div>}

            <div className="lms-cards">
              {adminEntries.map(renderEntryCard)}
              {regularEntries.map(renderEntryCard)}
              {categoryEntries.length === 0 && (
                <div className="lms-empty">아직 등록된 템플릿이 없습니다. &quot;+ 템플릿 추가&quot;로 새로 만들어보세요.</div>
              )}
            </div>
          </>
        ) : (
          <div className="lms-empty">왼쪽에서 카테고리를 선택해주세요.</div>
        )}
      </div>
      </div>
    </>
  );
}
