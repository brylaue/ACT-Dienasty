/*
  Tiny HTML sanitizer + escaper for external strings.

  Why it exists: several components render third-party content with
  {@html} - news-feed article bodies (internet-random) and Sleeper team
  and player names (editable by any league member). Raw {@html} on those
  is a stored-XSS vector. sanitizeHtml() keeps harmless formatting and
  strips anything executable; esc() is for names interpolated into
  markup strings.
*/

export const esc = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const ALLOWED_TAGS = new Set(['P', 'BR', 'B', 'I', 'EM', 'STRONG', 'U', 'A', 'UL', 'OL', 'LI', 'SPAN', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'CODE', 'PRE', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH']);

export const sanitizeHtml = (html) => {
  if (!html) return '';
  // SSR safety: no DOM parser on the server - escape everything there;
  // the client re-renders with the real sanitizer after hydration
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return esc(html);

  const doc = new DOMParser().parseFromString(String(html), 'text/html');

  const clean = (node) => {
    for (const el of [...node.querySelectorAll('*')]) {
      if (!ALLOWED_TAGS.has(el.tagName)) {
        el.replaceWith(...el.childNodes); // keep text, drop the tag
        continue;
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        const ok =
          (name === 'href' && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'))) ||
          (name === 'src' && value.startsWith('https://')) ||
          name === 'alt' || name === 'title' || name === 'class';
        if (!ok) el.removeAttribute(attr.name);
      }
      if (el.tagName === 'A') {
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
};
