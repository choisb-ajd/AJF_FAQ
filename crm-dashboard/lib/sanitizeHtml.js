// 딜러앱 FAQ 메모장에 저장되는 리치텍스트(HTML)를 안전하게 정리합니다.
// 에디터 툴바(굵게/기울임/밑줄/글자색/배경색/크기)가 만들어내는 태그만 허용하고,
// 스크립트/이벤트 핸들러 등 위험한 내용은 모두 제거합니다.

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'DIV', 'P', 'BR', 'UL', 'OL', 'LI', 'FONT']);
const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration']);
const SAFE_VALUE_RE = /^[a-zA-Z0-9#(),.\s%]+$/;

function sanitizeStyleAttr(value) {
  return (value || '')
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return null;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop) || !SAFE_VALUE_RE.test(val)) return null;
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(';');
}

function sanitizeNotepadHtml(html) {
  const raw = (html || '').toString();
  // 위험한 태그는 내용까지 통째로 제거
  let cleaned = raw.replace(/<(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/<(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, '');

  return cleaned.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tagName, attrs) => {
    const tag = tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (match.startsWith('</')) return `</${tag.toLowerCase()}>`;

    let safeAttrs = '';
    const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
    if (styleMatch) {
      const safeStyle = sanitizeStyleAttr(styleMatch[1]);
      if (safeStyle) safeAttrs += ` style="${safeStyle}"`;
    }
    if (tag === 'FONT') {
      const colorMatch = attrs.match(/color\s*=\s*"([^"]*)"/i);
      if (colorMatch && /^#?[0-9a-fA-F]{3,8}$/.test(colorMatch[1])) {
        safeAttrs += ` color="${colorMatch[1]}"`;
      }
    }
    return `<${tag.toLowerCase()}${safeAttrs}>`;
  });
}

function escapeHtml(text) {
  return (text || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sanitizeNotepadHtml, escapeHtml };
