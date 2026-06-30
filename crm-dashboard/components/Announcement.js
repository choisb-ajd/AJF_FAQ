import { useEffect, useState } from 'react';

const MAX_LENGTH = 50;

export default function Announcement({ isAdmin }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/announcement')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data && data.ok) setText(data.text || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function startEdit() {
    setDraft(text);
    setError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError('');
  }

  async function save() {
    const trimmed = draft.trim();
    if (trimmed.length > MAX_LENGTH) {
      setError(`공지사항은 ${MAX_LENGTH}자 이내로 입력해주세요.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setText(data.text || '');
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="topbar-announcement editing">
        <span className="topbar-announcement-icon">📢</span>
        <input
          autoFocus
          className="topbar-announcement-input"
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') cancelEdit();
          }}
          placeholder="공지사항을 입력하세요"
        />
        <button type="button" className="topbar-announcement-btn" onClick={save} disabled={saving}>저장</button>
        <button type="button" className="topbar-announcement-btn" onClick={cancelEdit} disabled={saving}>취소</button>
        {error && <span className="topbar-announcement-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className={`topbar-announcement${isAdmin ? ' admin' : ''}`} onClick={isAdmin ? startEdit : undefined}>
      <span className="topbar-announcement-icon">📢</span>
      <span className="topbar-announcement-text">
        {text || (isAdmin ? '공지사항을 입력하려면 클릭하세요' : '')}
      </span>
    </div>
  );
}
