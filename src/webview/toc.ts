// Right-hand table of contents: collapsible, resizable, follows the reading position,
// and shows search hits per section.

import type { Heading } from './render';
import { el, icon } from './icons';
import { saveUiState, uiState } from './host';

interface Node {
  heading: Heading;
  children: Node[];
  li: HTMLLIElement;
  parent?: Node;
}

const MIN_WIDTH = 180;
const DEFAULT_WIDTH = 260;
const AUTO_COLLAPSE_OVER = 60;

export class Toc {
  readonly element: HTMLElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private toggleAllBtn: HTMLButtonElement;
  private nodes = new Map<string, Node>();
  private roots: Node[] = [];
  private activeId?: string;
  private collapsed = new Map<string, Set<string>>(); // per document
  private docKey = '';
  private signature = '';
  private counts?: Map<string, number>;

  constructor(private readonly onSelect: (id: string) => void) {
    this.element = el('aside', 'ml-toc');
    this.element.setAttribute('aria-label', 'Table of contents');
    const handle = el('div', 'ml-toc-resize');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Resize table of contents');
    handle.tabIndex = 0;
    const head = el('div', 'ml-toc-head');
    const label = el('span', 'ml-toc-label', 'Contents');
    this.toggleAllBtn = el('button', 'ml-icon-btn', icon('collapse-all'));
    this.toggleAllBtn.type = 'button';
    this.toggleAllBtn.addEventListener('click', () => this.toggleAll());
    head.append(label, this.toggleAllBtn);
    this.list = el('nav', 'ml-toc-tree');
    this.empty = el('p', 'ml-toc-empty', 'No headings in this document.');
    this.element.append(handle, head, this.list, this.empty);
    this.setWidth(uiState().tocWidth ?? DEFAULT_WIDTH);
    this.initResize(handle);

    this.list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const twisty = target.closest<HTMLElement>('.ml-toc-twisty');
      const li = target.closest<HTMLLIElement>('li');
      if (!li) return;
      const id = li.dataset.id!;
      if (twisty) {
        this.setCollapsed(id, li.getAttribute('aria-expanded') === 'true');
        return;
      }
      if (target.closest('a')) {
        e.preventDefault();
        this.onSelect(id);
      }
    });
  }

  setHeadings(docKey: string, headings: Heading[], depth: number): void {
    const visible = headings.filter((h) => h.level <= depth);
    const signature = `${docKey}\u0000${visible.map((h) => `${h.level}:${h.id}:${h.text}`).join('\n')}`;
    if (signature === this.signature) return;
    const isNewDoc = docKey !== this.docKey;
    this.signature = signature;
    this.docKey = docKey;
    this.nodes.clear();
    this.roots = [];

    const stack: Node[] = [];
    for (const h of visible) {
      while (stack.length && stack[stack.length - 1].heading.level >= h.level) stack.pop();
      const node: Node = { heading: h, children: [], li: document.createElement('li'), parent: stack[stack.length - 1] };
      (node.parent ? node.parent.children : this.roots).push(node);
      this.nodes.set(h.id, node);
      stack.push(node);
    }

    if (isNewDoc && !this.collapsed.has(docKey)) {
      // Long documents start with the top two levels open.
      const set = new Set<string>();
      if (visible.length > AUTO_COLLAPSE_OVER) {
        for (const n of this.nodes.values()) if (depthOf(n) >= 1 && n.children.length) set.add(n.heading.id);
      }
      this.collapsed.set(docKey, set);
    }

    const ul = document.createElement('ul');
    for (const n of this.roots) ul.append(this.renderNode(n, 0));
    this.list.replaceChildren(ul);
    this.empty.hidden = visible.length > 0;
    this.toggleAllBtn.hidden = ![...this.nodes.values()].some((n) => n.children.length);
    this.updateToggleAll();
    if (this.counts) this.setCounts(this.counts);
    const active = this.activeId;
    this.activeId = undefined;
    if (active) this.setActive(active, false);
  }

  private renderNode(n: Node, depth: number): HTMLLIElement {
    const li = n.li;
    li.dataset.id = n.heading.id;
    const row = el('div', 'ml-toc-row');
    row.style.setProperty('--depth', String(depth));
    if (n.children.length) {
      const tw = el('button', 'ml-toc-twisty', icon('chevron-right'));
      tw.type = 'button';
      tw.tabIndex = -1;
      tw.setAttribute('aria-label', 'Toggle section');
      row.append(tw);
    } else {
      row.append(el('span', 'ml-toc-twisty-space'));
    }
    const a = el('a', 'ml-toc-link');
    a.href = `#${encodeURIComponent(n.heading.id)}`;
    a.textContent = n.heading.text || '(untitled)';
    a.title = n.heading.text;
    row.append(a, el('span', 'ml-toc-count'));
    li.append(row);
    if (n.children.length) {
      const isCollapsed = this.collapsedSet().has(n.heading.id);
      li.setAttribute('aria-expanded', String(!isCollapsed));
      const ul = document.createElement('ul');
      for (const c of n.children) ul.append(this.renderNode(c, depth + 1));
      li.append(ul);
    }
    return li;
  }

  private collapsedSet(): Set<string> {
    let s = this.collapsed.get(this.docKey);
    if (!s) this.collapsed.set(this.docKey, (s = new Set()));
    return s;
  }

  private setCollapsed(id: string, collapse: boolean): void {
    const n = this.nodes.get(id);
    if (!n || !n.children.length) return;
    if (collapse) this.collapsedSet().add(id);
    else this.collapsedSet().delete(id);
    n.li.setAttribute('aria-expanded', String(!collapse));
    this.updateToggleAll();
    if (this.counts) this.setCounts(this.counts);
  }

  private toggleAll(): void {
    const anyOpen = [...this.nodes.values()].some((n) => n.children.length && !this.collapsedSet().has(n.heading.id));
    for (const n of this.nodes.values()) if (n.children.length) this.setCollapsed(n.heading.id, anyOpen);
    if (!anyOpen) return;
    // Keep the reader's place visible.
    if (this.activeId) this.reveal(this.activeId);
  }

  private updateToggleAll(): void {
    const anyOpen = [...this.nodes.values()].some((n) => n.children.length && !this.collapsedSet().has(n.heading.id));
    this.toggleAllBtn.innerHTML = icon(anyOpen ? 'collapse-all' : 'expand-all');
    const label = anyOpen ? 'Collapse all' : 'Expand all';
    this.toggleAllBtn.title = label;
    this.toggleAllBtn.setAttribute('aria-label', label);
  }

  /** Marks the section being read; opens its parents and scrolls it into view. */
  setActive(id: string | undefined, scroll = true): void {
    if (id === this.activeId) return;
    if (this.activeId) this.nodes.get(this.activeId)?.li.classList.remove('ml-active');
    this.activeId = id;
    if (!id) return;
    const n = this.nodes.get(id);
    if (!n) return;
    n.li.classList.add('ml-active');
    if (scroll) this.reveal(id);
  }

  private reveal(id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    let row: HTMLElement = n.li.querySelector('.ml-toc-row')!;
    // Collapsed ancestors stay collapsed; highlight the visible ancestor instead.
    for (let p = n.parent; p; p = p.parent) if (this.collapsedSet().has(p.heading.id)) row = p.li.querySelector('.ml-toc-row')!;
    const lr = this.list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < lr.top + 8 || rr.bottom > lr.bottom - 8) {
      this.list.scrollTop += rr.top - lr.top - lr.height / 3;
    }
  }

  /** Search hits per heading id; undefined clears the badges. */
  setCounts(counts: Map<string, number> | undefined): void {
    this.counts = counts;
    for (const n of this.nodes.values()) {
      const total = counts ? subtreeCount(n, counts) : 0;
      const own = counts?.get(n.heading.id) ?? 0;
      const badge = n.li.querySelector(':scope > .ml-toc-row > .ml-toc-count')!;
      // Expanded parents show their own hits; collapsed ones include their children.
      const shown = n.children.length && this.collapsedSet().has(n.heading.id) ? total : own;
      badge.textContent = shown ? String(shown) : '';
      n.li.classList.toggle('ml-has-hits', !!counts && total > 0);
      n.li.classList.toggle('ml-no-hits', !!counts && total === 0);
    }
    this.element.classList.toggle('ml-searching', !!counts);
  }

  private setWidth(w: number): void {
    const max = Math.max(MIN_WIDTH, Math.min(560, window.innerWidth * 0.6));
    this.element.style.width = `${Math.round(Math.min(max, Math.max(MIN_WIDTH, w)))}px`;
  }

  private initResize(handle: HTMLElement): void {
    let start: { x: number; w: number } | undefined;
    handle.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, w: this.element.offsetWidth };
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('ml-resizing');
    });
    handle.addEventListener('pointermove', (e) => {
      if (start) this.setWidth(start.w - (e.clientX - start.x));
    });
    const end = () => {
      if (!start) return;
      start = undefined;
      document.body.classList.remove('ml-resizing');
      saveUiState({ tocWidth: this.element.offsetWidth });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => {
      this.setWidth(DEFAULT_WIDTH);
      saveUiState({ tocWidth: DEFAULT_WIDTH });
    });
    handle.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
      if (!d) return;
      e.preventDefault();
      this.setWidth(this.element.offsetWidth + d);
      saveUiState({ tocWidth: this.element.offsetWidth });
    });
  }
}

function depthOf(n: Node): number {
  let d = 0;
  for (let p = n.parent; p; p = p.parent) d++;
  return d;
}

function subtreeCount(n: Node, counts: Map<string, number>): number {
  let total = counts.get(n.heading.id) ?? 0;
  for (const c of n.children) total += subtreeCount(c, counts);
  return total;
}
