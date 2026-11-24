// Turns sanitised Markdown HTML into the reader's DOM: resolves image paths, wraps
// wide tables, adds code-block headers and heading links. Runs on fresh nodes only.

import { icon, el } from './icons';

export interface DecorateContext {
  baseHref: string;
  rootHref: string;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function decorate(root: ParentNode, ctx: DecorateContext): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src]')) resolveImage(img, ctx);
  for (const table of root.querySelectorAll('table')) wrapTable(table);
  for (const pre of root.querySelectorAll<HTMLElement>('pre.ml-code')) codeHeader(pre);
  for (const h of root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) headingLink(h);
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) markLink(a);
}

function resolveImage(img: HTMLImageElement, ctx: DecorateContext): void {
  const src = img.getAttribute('src') ?? '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (!src || SCHEME_RE.test(src) || src.startsWith('//')) return;
  try {
    const resolved = src.startsWith('/') ? new URL(src.slice(1), ctx.rootHref) : new URL(src, ctx.baseHref);
    img.src = resolved.toString();
  } catch {
    /* leave as written */
  }
}

function wrapTable(table: HTMLTableElement): void {
  if (table.parentElement?.classList.contains('ml-table-scroll')) return;
  const wrap = el('div', 'ml-table-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Table');
  const line = table.getAttribute('data-line');
  if (line) wrap.setAttribute('data-line', line);
  table.replaceWith(wrap);
  wrap.append(table);
}

function codeHeader(pre: HTMLElement): void {
  if (pre.parentElement?.classList.contains('ml-codeblock')) return;
  const block = el('div', 'ml-codeblock');
  const line = pre.getAttribute('data-line');
  if (line) block.setAttribute('data-line', line);
  pre.removeAttribute('data-line');
  const lang = pre.getAttribute('data-lang') ?? '';
  const head = el('div', 'ml-codeblock-head');
  head.append(el('span', 'ml-codeblock-lang', escape(lang)));
  const copy = el('button', 'ml-icon-btn ml-copy', icon('copy'));
  copy.type = 'button';
  copy.title = 'Copy code';
  copy.setAttribute('aria-label', 'Copy code');
  copy.dataset.action = 'copy-code';
  head.append(copy);
  pre.replaceWith(block);
  block.append(head, pre);
}

function headingLink(h: HTMLElement): void {
  if (h.querySelector('.ml-heading-link')) return;
  const a = el('button', 'ml-heading-link', icon('link'));
  a.type = 'button';
  a.title = 'Copy link to this section';
  a.setAttribute('aria-label', 'Copy link to this section');
  a.dataset.action = 'copy-heading-link';
  h.append(a);
}

function markLink(a: HTMLAnchorElement): void {
  const href = a.getAttribute('href') ?? '';
  if (/^https?:/i.test(href)) {
    a.classList.add('ml-external');
    a.title ||= href;
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
