import { useState } from 'react';
import FaqNotepad from './FaqNotepad';
import useEscapeKey from '../lib/useEscapeKey';

export default function FaqWidget({ isAdmin }) {
  const [open, setOpen] = useState(false);

  useEscapeKey(() => setOpen(false));

  return (
    <>
      <button type="button" className="faq-fab" onClick={() => setOpen(true)}>
        📌 FAQ
      </button>
      <div className={`faq-panel-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <div className={`faq-panel${open ? ' open' : ''}`}>
        <div className="faq-panel-header">
          <span className="faq-panel-title">딜러앱 FAQ</span>
          <button type="button" className="faq-panel-close" onClick={() => setOpen(false)}>닫기</button>
        </div>
        <div className="faq-panel-body">
          {open && <FaqNotepad isAdmin={isAdmin} />}
        </div>
      </div>
    </>
  );
}
