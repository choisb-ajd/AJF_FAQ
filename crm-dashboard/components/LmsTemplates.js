import { useEffect, useState } from 'react';

export default function LmsTemplates() {
  const [templates, setTemplates] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [addError, setAddError] = useState('');

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
        const list = data.templates || [];
        setTemplates(list);
        if (list.length > 0) setActiveId(list[0].id);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const active = templates.find((t) => t.id === activeId) || null;

  function selectTab(id) {
    if (editing && editContent !== (active ? active.content : '')) {
      if (!window.confirm('저장하지 않은 수정 내용이 있습니다. 이동하시겠습니까?')) return;
    }
    setActiveId(id);
    setEditing(false);
    setSaveError('');
    setCopyMsg('');
  }

  function startEdit() {
    if (!active) return;
    setEditContent(active.content || '');
    setSaveError('');
    setCopyMsg('');
    setEditing(true);
  }

  async function saveEdit() {
    if (!active) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: active.id, content: editContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setTemplates(data.templates);
      setEditing(false);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!active || !active.content) return;
    try {
      await navigator.clipboard.writeText(active.content);
      setCopyMsg('복사되었습니다.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = active.content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopyMsg('복사되었습니다.');
      } catch {
        setCopyMsg('복사에 실패했습니다.');
      }
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopyMsg(''), 2000);
  }

  async function submitAdd() {
    const title = newTitle.trim();
    if (!title) {
      setAddError('템플릿 이름을 입력해주세요.');
      return;
    }
    setAddError('');
    try {
      const res = await fetch('/api/lms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추가하지 못했습니다.');
      setTemplates(data.templates);
      const created = data.templates[data.templates.length - 1];
      setActiveId(created.id);
      setAdding(false);
      setNewTitle('');
      setEditContent('');
      setEditing(true);
    } catch (e) {
      setAddError(e.message);
    }
  }

  if (loading) return <div className="loading-state">불러오는 중...</div>;
  if (error && templates.length === 0) return <div className="error-state">{error}</div>;

  return (
    <div className="lms-wrap">
      <div className="lms-tabs">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`lms-tab${t.id === activeId ? ' active' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            {t.title}
          </button>
        ))}
        {adding ? (
          <span className="lms-tab-add-form">
            <input
              autoFocus
              placeholder="템플릿 이름"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setNewTitle('');
                  setAddError('');
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={submitAdd}>추가</button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAdding(false);
                setNewTitle('');
                setAddError('');
              }}
            >
              취소
            </button>
          </span>
        ) : (
          <button type="button" className="lms-tab lms-tab-add" onClick={() => setAdding(true)}>+ 등록하기</button>
        )}
      </div>
      {addError && <div className="error-state lms-inline-error">{addError}</div>}

      {active && (
        <div className="lms-panel">
          <div className="lms-panel-head">
            <h2>{active.title}</h2>
            <div className="lms-panel-actions">
              {copyMsg && <span className="lms-copy-msg">{copyMsg}</span>}
              {!editing && (
                <button type="button" className="btn" onClick={handleCopy} disabled={!active.content}>
                  복사
                </button>
              )}
              {!editing && (
                <button type="button" className="btn btn-primary" onClick={startEdit}>수정</button>
              )}
            </div>
          </div>

          {saveError && <div className="error-state lms-inline-error">{saveError}</div>}

          {editing ? (
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
                  <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>취소</button>
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
                {active.content || <span className="notepad-empty">아직 등록된 문구가 없습니다. 수정 버튼을 눌러 작성해보세요.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
