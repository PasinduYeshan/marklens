import DOMPurify from 'dompurify';

// Raw HTML in Markdown is allowed (GitHub does too) but scripts, event handlers,
// forms and frames are not. The webview's CSP is the second line of defence.
const purifier = DOMPurify(window);

purifier.addHook('uponSanitizeAttribute', (_node, data) => {
  // Inline styles are fine (KaTeX needs them) but never url()s that fetch remote content.
  if (data.attrName === 'style' && /url\s*\(/i.test(data.attrValue)) data.keepAttr = false;
});

export function sanitize(html: string): DocumentFragment {
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'style', 'base', 'meta', 'link'],
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['data-line', 'data-lang', 'open'],
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;
}
