import { useEffect, useRef, useState } from 'react';

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

export default function FaqNotepad({ isAdmin }) {
  const editorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [migrated, setMigrated] = useState(false);
  const [loadedHtml, setLoadedHtml] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetch('/api/faq')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '불러오지 못했습니다.');
        return data;
      })
      .then((data) => {
        if (!alive) return;
        setLoadedHtml(data.html || '');
        setMigrated(!!data.migrated);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // 서버에서 막 받아온 내용을 에디터에 1회 주입합니다(이후 타이핑할 때마다 다시 덮어쓰지 않음).
  useEffect(() => {
    if (loadedHtml !== null && editorRef.current) {
      editorRef.current.innerHTML = loadedHtml;
    }
  }, [loadedHtml]);

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedRangeRef.current) sel.addRange(savedRangeRef.current);
    editorRef.current.focus();
  }

  function exec(command, value) {
    editorRef.current.focus();
    document.execCommand(command, false, value);
  }

  function handleFontSize(e) {
    const px = e.target.value;
    e.target.value = '';
    if (!px) return;
    restoreSelection();
    document.execCommand('fontSize', false, '7');
    editorRef.current.querySelectorAll('font[size="7"]').forEach((el) => {
      el.removeAttribute('size');
      el.style.fontSize = `${px}px`;
    });
  }

  // 엑셀/워드 등에서 복사한 내용을 붙여넣어도 서식 없이 글자만 들어가도록 강제합니다.
  function handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    setError('');
    try {
      const html = editorRef.current.innerHTML;
      const res = await fetch('/api/faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setMigrated(false);
      setSaveMsg('저장되었습니다.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-state">불러오는 중...</div>;
  if (error) return <div className="error-state">{error}</div>;

  if (!isAdmin) {
    return (
      <div className="notepad-wrap">
        <div
          className="notepad-view"
          dangerouslySetInnerHTML={{
            __html: loadedHtml || '<div class="notepad-empty">아직 등록된 내용이 없습니다.</div>',
          }}
        />
      </div>
    );
  }

  return (
    <div className="notepad-wrap">
      {migrated && (
        <div className="notepad-banner">
          기존 시트에 있던 내용을 그대로 불러왔습니다. 확인 후 저장하면 새 형식으로 저장됩니다.
        </div>
      )}
      <div className="notepad-toolbar">
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}><u>U</u></button>
        <select defaultValue="" onChange={handleFontSize}>
          <option value="" disabled>크기</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }}>서식 지우기</button>
        <div className="notepad-save-group">
          {saveMsg && <span className="notepad-save-msg">{saveMsg}</span>}
          <button type="button" className="btn btn-primary notepad-save" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
      <div
        ref={editorRef}
        className="notepad-editor"
        contentEditable
        suppressContentEditableWarning
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        onPaste={handlePaste}
      />
    </div>
  );
}
