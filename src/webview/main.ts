import type { DocPayload, HostMessage, NavState, ScrollTarget, ViewConfig } from '../shared/protocol';
import { decorate } from './decorate';
import { Diagrams } from './diagrams';
import { hostState, isHarness, onMessage, saveHostState, send } from './host';
import { el, icon, iconButton, isMac, modKey } from './icons';
import { PanZoom } from './panzoom';
import { render, type Heading } from './render';
import { sanitize } from './sanitize';
import { LineMap } from './scroll';
import { Search } from './search';
import { Toc } from './toc';
import { closeMenus, openOverlay, toast } from './ui';

// ---------------------------------------------------------------- state

let config: ViewConfig | undefined;
let doc: DocPayload | undefined;
let headings: Heading[] = [];
/** Top-level node keys (HTML without data-line) and first lines, for incremental updates. */
let blockKeys: string[] = [];
let blockLines: (number | undefined)[] = [];
let pendingRestore: { line: number; offset: number; until: number } | undefined;
let ignoreScrollUntil = 0;
let tocDrawerOpen = false;

// ---------------------------------------------------------------- shell

const app = el('div', 'ml-app');
const toolbar = el('header', 'ml-toolbar');
const backBtn = el('span', '', iconButton('arrow-left', `Back (${isMac ? '⌘[' : 'Alt+←'})`)).firstElementChild as HTMLButtonElement;
const fwdBtn = el('span', '', iconButton('arrow-right', `Forward (${isMac ? '⌘]' : 'Alt+→'})`)).firstElementChild as HTMLButtonElement;
const crumb = el('div', 'ml-crumb');
const crumbDoc = el('button', 'ml-crumb-doc');
crumbDoc.type = 'button';
const crumbSection = el('span', 'ml-crumb-section');
crumb.append(crumbDoc, crumbSection);
const actions = el('div', 'ml-actions');
const editBtn = el('span', '', iconButton('edit', `Edit (${modKey}+E)`)).firstElementChild as HTMLButtonElement;
const findBtn = el('span', '', iconButton('search', `Find (${modKey}+F)`)).firstElementChild as HTMLButtonElement;
const typeBtn = el('span', '', iconButton('text-size', 'Reading settings')).firstElementChild as HTMLButtonElement;
typeBtn.setAttribute('aria-haspopup', 'dialog');
const tocBtn = el('span', '', iconButton('list-tree', `Table of contents (${modKey}+Shift+O)`)).firstElementChild as HTMLButtonElement;
actions.append(editBtn, findBtn, typeBtn, tocBtn);

const main = el('div', 'ml-main');
const scroller = el('main', 'ml-scroller');
scroller.tabIndex = -1;
const article = el('article', 'ml-doc');
const emptyState = el('div', 'ml-empty');
scroller.append(article, emptyState);

const lineMap = new LineMap(scroller, article);
const toc = new Toc((id) => {
  if (isNarrow()) setDrawer(false);
  send({ type: 'navigate', href: `#${id}` });
});
const search = new Search({ article, scroller, onCounts: (c) => toc.setCounts(c) });
toolbar.append(el('div', 'ml-nav'), crumb, search.element, actions);
toolbar.firstElementChild!.append(backBtn, fwdBtn);
main.append(scroller, toc.element);
app.append(toolbar, main);
document.body.append(app);

const diagrams = new Diagrams(
  {
    docName: () => doc?.name ?? 'document',
    copy: (text, label) => copyText(text, label),
    save: (suggestedName, data, encoding, filterName, extension) => {
      if (isHarness) return harnessDownload(suggestedName, data, encoding);
      send({ type: 'save', suggestedName, data, encoding, filterName, extension });
    },
    layoutChanged: () => {
      lineMap.invalidate();
      applyPendingRestore();
      reportStats();
    },
  },
  scroller,
  () => config?.mermaidTheme ?? 'auto',
);

showEmpty('Loading…');

// ---------------------------------------------------------------- messages

onMessage((m: HostMessage) => {
  switch (m.type) {
    case 'config':
      applyConfig(m.config);
      break;
    case 'load':
      loadDoc(m.doc, m.scroll);
      setNav(m.nav);
      break;
    case 'update':
      if (doc && m.uri === doc.uri) {
        doc = { ...doc, text: m.text };
        renderDoc(false);
      }
      break;
    case 'nav':
      setNav(m.nav);
      break;
    case 'scrollTo':
      applyScroll(m.scroll, true);
      break;
    case 'syncToLine':
      syncToLine(m.line);
      break;
    case 'command':
      if (m.command === 'find') search.open();
      else toggleToc();
      break;
    case 'error':
      toast(m.message, 'error');
      break;
    case 'persist':
      saveHostState(m.state);
      break;
  }
});

send({ type: 'ready', state: hostState() });

// ---------------------------------------------------------------- rendering

function loadDoc(next: DocPayload, scroll: ScrollTarget): void {
  const sameDoc = doc?.uri === next.uri;
  doc = next;
  blockKeys = [];
  blockLines = [];
  article.replaceChildren();
  renderDoc(true);
  crumbDoc.textContent = next.name;
  crumbDoc.title = `${next.path}. Click to scroll to the top.`;
  document.title = next.name;
  applyScroll(scroll, sameDoc);
  search.refresh();
}

function renderDoc(full: boolean): void {
  if (!doc || !config) return;
  let result;
  try {
    result = render(doc.text, { breaks: config.breaks });
  } catch (err) {
    toast(`Couldn't render this document: ${String(err)}`, 'error');
    return;
  }
  headings = result.headings;
  const fragment = sanitize(result.html);
  const nodes = [...fragment.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
  const keys = nodes.map(nodeKey);
  const lines = nodes.map(firstLine);

  if (full || blockKeys.length === 0) {
    decorateNodes(nodes);
    article.replaceChildren(...nodes);
  } else {
    patch(nodes, keys, lines);
  }
  blockKeys = keys;
  blockLines = lines;

  const isEmpty = !doc.text.trim();
  if (isEmpty) showEmpty('This document is empty.');
  else emptyState.hidden = true;

  lineMap.invalidate();
  toc.setHeadings(doc.uri, headings, config.tocDepth);
  diagrams.process(article);
  updateSpy();
  if (!full) search.refresh();
  reportStats();
}

let statsTimer: ReturnType<typeof setTimeout> | undefined;
function reportStats(): void {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    if (!doc) return;
    const count = (sel: string) => article.querySelectorAll(sel).length;
    send({
      type: 'stats',
      stats: {
        uri: doc.uri,
        blocks: article.childElementCount,
        headings: headings.length,
        diagrams: count('.ml-mermaid'),
        diagramsDone: count('.ml-mermaid[data-state="done"]'),
        diagramsFailed: count('.ml-mermaid[data-state="error"]'),
      },
    });
  }, 250);
}

/** Replace only the changed top-level blocks so diagrams, zoom and scroll stay put. */
function patch(nodes: ChildNode[], keys: string[], lines: (number | undefined)[]): void {
  const old = [...article.childNodes];
  if (old.length !== blockKeys.length) {
    decorateNodes(nodes);
    article.replaceChildren(...nodes);
    return;
  }
  let start = 0;
  while (start < old.length && start < keys.length && blockKeys[start] === keys[start]) start++;
  let endOld = old.length;
  let endNew = keys.length;
  while (endOld > start && endNew > start && blockKeys[endOld - 1] === keys[endNew - 1]) {
    endOld--;
    endNew--;
  }
  // Kept blocks may have moved up or down in the source.
  shiftLines(old, 0, start, (i) => lines[i]);
  shiftLines(old, endOld, old.length, (i) => lines[i - endOld + endNew]);

  const fresh = nodes.slice(start, endNew);
  decorateNodes(fresh);
  const before = old[endOld] ?? null;
  for (let i = start; i < endOld; i++) old[i].remove();
  for (const n of fresh) article.insertBefore(n, before);
}

function shiftLines(old: ChildNode[], from: number, to: number, newLine: (i: number) => number | undefined): void {
  for (let i = from; i < to; i++) {
    const prev = blockLines[i];
    const next = newLine(i);
    if (prev === undefined || next === undefined || prev === next) continue;
    const delta = next - prev;
    const node = old[i];
    if (!(node instanceof HTMLElement)) continue;
    for (const e of [node, ...node.querySelectorAll<HTMLElement>('[data-line]')]) {
      if (e.dataset.line !== undefined) e.dataset.line = String(Number(e.dataset.line) + delta);
    }
  }
}

function decorateNodes(nodes: ChildNode[]): void {
  const holder = document.createDocumentFragment();
  holder.append(...nodes);
  decorate(holder, ctx());
  // decorate() may wrap nodes; hand back the (possibly new) top-level nodes in order.
  nodes.length = 0;
  nodes.push(...holder.childNodes);
}

function ctx() {
  return { baseHref: doc?.baseHref ?? '', rootHref: doc?.rootHref ?? '' };
}

function nodeKey(n: ChildNode): string {
  return n instanceof Element ? n.outerHTML.replace(/ data-line="\d+"/g, '') : (n.textContent ?? '');
}

function firstLine(n: ChildNode): number | undefined {
  const v = n instanceof HTMLElement ? n.dataset.line : undefined;
  return v === undefined ? undefined : Number(v);
}

function showEmpty(message: string): void {
  emptyState.hidden = false;
  emptyState.innerHTML = `${icon('book')}<p></p>`;
  emptyState.querySelector('p')!.textContent = message;
}

// ---------------------------------------------------------------- config & nav

function applyConfig(c: ViewConfig): void {
  const prev = config;
  config = c;
  const root = document.body.style;
  root.setProperty('--ml-font-size', `${c.fontSize}px`);
  root.setProperty('--ml-line-height', String(c.lineHeight));
  if (c.fontFamily) root.setProperty('--ml-font-body', c.fontFamily);
  else root.removeProperty('--ml-font-body');
  if (c.codeFontFamily) root.setProperty('--ml-font-code', c.codeFontFamily);
  else root.removeProperty('--ml-font-code');
  applyTheme();
  app.dataset.width = c.contentWidth;
  app.dataset.spacing = c.spacing;
  app.classList.toggle('ml-toc-hidden', !c.tocVisible);
  updateTocButton();
  if (prev && doc && (prev.breaks !== c.breaks || prev.tocDepth !== c.tocDepth)) {
    blockKeys = [];
    renderDoc(true);
  }
  if (prev && (prev.mermaidTheme !== c.mermaidTheme || prev.theme !== c.theme)) diagrams.refreshTheme();
  if (settingsPanel) renderSettings();
}

function setNav(n: NavState): void {
  backBtn.disabled = !n.canBack;
  fwdBtn.disabled = !n.canForward;
  app.dataset.mode = n.mode;
  const label = n.mode === 'reader' ? `Edit (${modKey}+E)` : `Open source to edit (${modKey}+E)`;
  editBtn.title = label;
  editBtn.setAttribute('aria-label', label);
}

// ---------------------------------------------------------------- scrolling

function applyScroll(target: ScrollTarget, smooth: boolean): void {
  pendingRestore = undefined;
  switch (target.kind) {
    case 'top':
      scroller.scrollTop = 0;
      return;
    case 'keep':
      return;
    case 'fragment': {
      const el = findTarget(target.fragment);
      if (!el) {
        if (target.fragment) toast(`No section named “${target.fragment}” in ${doc?.name ?? 'this document'}.`, 'error');
        return;
      }
      for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
      const top = lineMap.top(el) - 12;
      scroller.scrollTo({ top, behavior: smooth && Math.abs(top - scroller.scrollTop) < 4000 ? 'smooth' : 'instant' });
      flash(el);
      // Diagrams above may still grow; keep the heading in place for a moment.
      const line = Number(el.closest<HTMLElement>('[data-line]')?.dataset.line);
      if (Number.isFinite(line)) pendingRestore = { line, offset: lineMap.top(el) - 12 - lineMap.scrollTopForRestore(line, 0), until: Date.now() + 1500 };
      return;
    }
    case 'restore':
      pendingRestore = { line: target.line, offset: target.offset, until: Date.now() + 2500 };
      applyPendingRestore();
      return;
  }
}

function applyPendingRestore(): void {
  const p = pendingRestore;
  if (!p) return;
  if (Date.now() > p.until) {
    pendingRestore = undefined;
    return;
  }
  ignoreScrollUntil = Date.now() + 100;
  scroller.scrollTop = lineMap.scrollTopForRestore(p.line, p.offset);
}

function findTarget(fragment: string): HTMLElement | null {
  if (!fragment) return null;
  const candidates = [fragment, fragment.toLowerCase(), slugish(fragment)];
  for (const id of candidates) {
    const e = document.getElementById(id);
    if (e && article.contains(e)) return e;
  }
  const named = article.querySelector<HTMLElement>(`a[name="${CSS.escape(fragment)}"]`);
  return named;
}

function slugish(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function flash(e: HTMLElement): void {
  e.classList.remove('ml-flash');
  void e.offsetWidth;
  e.classList.add('ml-flash');
}

function syncToLine(line: number): void {
  if (!config?.scrollSync || pendingRestore) return;
  ignoreScrollUntil = Date.now() + 120;
  scroller.scrollTop = lineMap.scrollTopFor(line);
}

new ResizeObserver(() => applyPendingRestore()).observe(article);
for (const type of ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const) {
  scroller.addEventListener(type, () => (pendingRestore = undefined), { passive: true });
}

let spyFrame = 0;
let positionTimer: ReturnType<typeof setTimeout> | undefined;
let lastReveal = 0;
scroller.addEventListener('scroll', () => {
  if (!spyFrame) spyFrame = requestAnimationFrame(updateSpy);
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    const p = lineMap.position();
    send({ type: 'position', line: p.line, offset: p.offset });
  }, 300);
  const now = Date.now();
  if (now < ignoreScrollUntil || !config?.scrollSync || pendingRestore) return;
  if (now - lastReveal > 50) {
    lastReveal = now;
    send({ type: 'revealLine', line: Math.floor(lineMap.position().fractional) });
  }
});

function updateSpy(): void {
  spyFrame = 0;
  const hs = article.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
  const top = scroller.getBoundingClientRect().top;
  const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  const limit = top + (atBottom ? scroller.clientHeight * 0.6 : 72);
  let active: HTMLElement | undefined;
  for (const h of hs) {
    if (h.getBoundingClientRect().top <= limit) active = h;
    else break;
  }
  toc.setActive(active?.id);
  crumbSection.textContent = active ? sectionPath(active.id) : '';
  crumb.classList.toggle('ml-has-section', !!active);
}

function sectionPath(id: string): string {
  const i = headings.findIndex((h) => h.id === id);
  if (i < 0) return '';
  const path: Heading[] = [headings[i]];
  for (let j = i - 1, level = headings[i].level; j >= 0 && level > 1; j--) {
    if (headings[j].level < level) {
      path.unshift(headings[j]);
      level = headings[j].level;
    }
  }
  // The document title (single H1) is already implied by the file name.
  if (path.length > 1 && path[0].level === 1) path.shift();
  return path.map((h) => h.text).join(' › ');
}

// ---------------------------------------------------------------- toolbar

backBtn.addEventListener('click', () => send({ type: 'back' }));
fwdBtn.addEventListener('click', () => send({ type: 'forward' }));
crumbDoc.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }));
editBtn.addEventListener('click', () => send({ type: 'edit' }));
findBtn.addEventListener('click', () => (search.isOpen ? search.close() : search.open()));
tocBtn.addEventListener('click', () => toggleToc());
typeBtn.addEventListener('click', () => toggleSettings());

function isNarrow(): boolean {
  return main.clientWidth < 720;
}

function toggleToc(): void {
  if (isNarrow()) {
    setDrawer(!tocDrawerOpen);
    return;
  }
  const visible = !(config?.tocVisible ?? true);
  if (config) applyConfig({ ...config, tocVisible: visible });
  send({ type: 'setting', key: 'tocVisible', value: visible });
}

function setDrawer(open: boolean): void {
  tocDrawerOpen = open;
  app.classList.toggle('ml-toc-drawer-open', open);
  updateTocButton();
}

function updateTocButton(): void {
  const shown = isNarrow() ? tocDrawerOpen : (config?.tocVisible ?? true);
  tocBtn.setAttribute('aria-pressed', String(shown));
  tocBtn.classList.toggle('ml-on', shown);
}

new ResizeObserver(() => {
  app.classList.toggle('ml-narrow', isNarrow());
  if (!isNarrow() && tocDrawerOpen) setDrawer(false);
  updateTocButton();
}).observe(main);

scroller.addEventListener('pointerdown', () => {
  if (tocDrawerOpen) setDrawer(false);
});

// Reading settings pop-over: the two things people change while reading.
let settingsPanel: HTMLElement | undefined;

function toggleSettings(): void {
  if (settingsPanel) {
    closeSettings();
    return;
  }
  settingsPanel = el('div', 'ml-popover');
  settingsPanel.setAttribute('role', 'dialog');
  settingsPanel.setAttribute('aria-label', 'Reading settings');
  document.body.append(settingsPanel);
  renderSettings();
  const r = typeBtn.getBoundingClientRect();
  settingsPanel.style.top = `${r.bottom + 6}px`;
  settingsPanel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  typeBtn.setAttribute('aria-expanded', 'true');
  settingsPanel.querySelector<HTMLButtonElement>('button')?.focus();
  document.addEventListener('pointerdown', onSettingsOutside, true);
}

function closeSettings(): void {
  settingsPanel?.remove();
  settingsPanel = undefined;
  typeBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onSettingsOutside, true);
}

function onSettingsOutside(e: PointerEvent): void {
  if (settingsPanel && !settingsPanel.contains(e.target as Node) && !typeBtn.contains(e.target as Node)) closeSettings();
}

const WIDTHS: [ViewConfig['contentWidth'], string][] = [
  ['narrow', 'Narrow'],
  ['medium', 'Medium'],
  ['wide', 'Wide'],
  ['full', 'Full'],
];

const THEMES: [ViewConfig['theme'], string][] = [
  ['auto', 'Auto'],
  ['light', 'Light'],
  ['paper', 'Paper'],
  ['dark', 'Dark'],
];

function renderSettings(): void {
  if (!settingsPanel || !config) return;
  const c = config;
  const focused = (document.activeElement as HTMLElement | null)?.dataset.key;
  settingsPanel.innerHTML = `
    <div class="ml-field">
      <span class="ml-field-label" id="ml-size-label">Text size</span>
      <div class="ml-stepper" role="group" aria-labelledby="ml-size-label">
        <button type="button" class="ml-icon-btn" data-key="size-down" aria-label="Smaller text" ${c.fontSize <= 10 ? 'disabled' : ''}>${icon('remove')}</button>
        <span class="ml-stepper-value">${c.fontSize}px</span>
        <button type="button" class="ml-icon-btn" data-key="size-up" aria-label="Larger text" ${c.fontSize >= 28 ? 'disabled' : ''}>${icon('add')}</button>
      </div>
    </div>
    <div class="ml-field">
      <span class="ml-field-label" id="ml-width-label">Line width</span>
      <div class="ml-segmented" role="radiogroup" aria-labelledby="ml-width-label">
        ${WIDTHS.map(([v, l]) => `<button type="button" role="radio" data-key="width-${v}" aria-checked="${c.contentWidth === v}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="ml-field">
      <span class="ml-field-label" id="ml-theme-label">Theme</span>
      <div class="ml-segmented" role="radiogroup" aria-labelledby="ml-theme-label">
        ${THEMES.map(([v, l]) => `<button type="button" role="radio" data-key="theme-${v}" aria-checked="${c.theme === v}">${l}</button>`).join('')}
      </div>
    </div>
    <p class="ml-popover-note">Auto follows VS Code. Fonts, spacing and more are in Settings › MarkLens.</p>`;
  if (focused) settingsPanel.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus();
  settingsPanel.onclick = (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
    if (!key || !config) return;
    if (key === 'size-down' || key === 'size-up') {
      const size = Math.min(28, Math.max(10, config.fontSize + (key === 'size-up' ? 1 : -1)));
      applyConfig({ ...config, fontSize: size });
      send({ type: 'setting', key: 'fontSize', value: size });
    } else if (key.startsWith('theme-')) {
      const theme = key.slice(6) as ViewConfig['theme'];
      applyConfig({ ...config, theme });
      send({ type: 'setting', key: 'theme', value: theme });
    } else if (key.startsWith('width-')) {
      const width = key.slice(6) as ViewConfig['contentWidth'];
      applyConfig({ ...config, contentWidth: width });
      send({ type: 'setting', key: 'contentWidth', value: width });
    }
  };
}

// ---------------------------------------------------------------- document interactions

article.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>('[data-action]');
  if (action?.dataset.action === 'copy-code') {
    const code = action.closest('.ml-codeblock')?.querySelector('code')?.textContent ?? '';
    copyText(code.replace(/\n$/, ''), 'Code copied');
    return;
  }
  if (action?.dataset.action === 'copy-heading-link') {
    const id = action.closest('h1, h2, h3, h4, h5, h6')?.id;
    if (id && doc) copyText(`${doc.path}#${id}`, 'Link to section copied');
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (link) {
    e.preventDefault();
    const href = link.getAttribute('href') ?? '';
    send({ type: 'navigate', href, newTab: e.metaKey || e.ctrlKey });
    return;
  }
  if (target instanceof HTMLImageElement && !target.closest('a')) openImage(target);
});

article.addEventListener('auxclick', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (link && e.button === 1) {
    e.preventDefault();
    send({ type: 'navigate', href: link.getAttribute('href') ?? '', newTab: true });
  }
});

// Mouse back/forward buttons.
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) send({ type: 'back' });
  else if (e.button === 4) send({ type: 'forward' });
});

// Keys are handled here and not passed on to VS Code, so a command never runs twice.
window.addEventListener(
  'keydown',
  (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
      handled();
      send({ type: 'edit' });
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      handled();
      search.open();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
      handled();
      toggleToc();
    } else if ((isMac && e.metaKey && e.key === '[') || (!isMac && e.altKey && e.key === 'ArrowLeft')) {
      handled();
      send({ type: 'back' });
    } else if ((isMac && e.metaKey && e.key === ']') || (!isMac && e.altKey && e.key === 'ArrowRight')) {
      handled();
      send({ type: 'forward' });
    } else if (e.key === 'Escape' && !document.body.classList.contains('ml-has-overlay')) {
      if (closeMenus()) handled();
      else if (settingsPanel) {
        handled();
        closeSettings();
        typeBtn.focus();
      } else if (tocDrawerOpen) {
        handled();
        setDrawer(false);
      } else if (search.isOpen) {
        handled();
        search.close();
      }
    }
  },
  true,
);

function openImage(img: HTMLImageElement): void {
  if (!img.naturalWidth) return;
  const view = el('div', 'ml-diagram-viewport ml-image-viewport');
  const canvas = el('div', 'ml-diagram-canvas');
  const clone = img.cloneNode() as HTMLImageElement;
  clone.removeAttribute('loading');
  clone.style.width = `${img.naturalWidth}px`;
  clone.style.height = `${img.naturalHeight}px`;
  clone.style.maxWidth = 'none';
  canvas.append(clone);
  view.append(canvas);
  view.tabIndex = 0;
  const ov = openOverlay(img.alt || 'Image', () => {});
  ov.body.append(view);
  const pz = new PanZoom(view, canvas, { w: img.naturalWidth, h: img.naturalHeight });
  pz.wheelMode = 'pan';
  const pct = el('span', 'ml-diagram-pct');
  pz.onChange = () => (pct.textContent = `${Math.round(pz.scale * 100)}%`);
  const tools = el('div', 'ml-diagram-tools');
  const mk = (name: string, label: string, run: () => void) => {
    const b = el('button', 'ml-icon-btn', icon(name));
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.onclick = run;
    return b;
  };
  const txt = (t: string, label: string, run: () => void) => {
    const b = el('button', 'ml-text-btn');
    b.type = 'button';
    b.textContent = t;
    b.title = label;
    b.onclick = run;
    return b;
  };
  tools.append(mk('zoom-out', 'Zoom out', () => pz.zoomBy(0.8)), pct, mk('zoom-in', 'Zoom in', () => pz.zoomBy(1.25)), txt('Fit', 'Fit to view', () => pz.fit(true)), txt('1:1', 'Actual size', () => pz.actualSize()));
  ov.tools.append(tools);
  view.addEventListener('keydown', (e) => {
    if (pz.handleKey(e, () => pz.fit(true))) e.preventDefault();
  });
  requestAnimationFrame(() => {
    pz.fit(false);
    view.focus();
  });
}

function copyText(text: string, label: string): void {
  if (isHarness) {
    void navigator.clipboard?.writeText(text).catch(() => {});
    toast(label);
    return;
  }
  send({ type: 'copy', text, label });
  toast(label);
}

function harnessDownload(name: string, data: string, encoding: 'utf8' | 'base64'): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = encoding === 'base64' ? `data:application/octet-stream;base64,${data}` : URL.createObjectURL(new Blob([data]));
  a.click();
}

/** 'auto' follows VS Code; light/dark override it with MarkLens' own palette. */
function applyTheme(): void {
  const theme = config?.theme ?? 'auto';
  if (theme === 'auto') delete document.body.dataset.mlTheme;
  else document.body.dataset.mlTheme = theme;
  const cls = document.body.classList;
  const vscodeDark = cls.contains('vscode-dark') || (cls.contains('vscode-high-contrast') && !cls.contains('vscode-high-contrast-light'));
  cls.toggle('ml-dark', theme === 'dark' || (theme === 'auto' && vscodeDark));
}

// Follow VS Code color theme changes; re-render diagrams in the new theme.
new MutationObserver(() => {
  applyTheme();
  diagrams.refreshTheme();
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

window.addEventListener('error', (e) => send({ type: 'log', level: 'error', message: `${e.message} (${e.filename}:${e.lineno})` }));
window.addEventListener('unhandledrejection', (e) => send({ type: 'log', level: 'error', message: String(e.reason) }));
