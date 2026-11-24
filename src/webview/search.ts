// Find in document. Uses the CSS Custom Highlight API, so the DOM is never modified
// and matches across inline formatting ("foo **bar**") are found.

import { el, icon, modKey } from './icons';

const SKIP_SELECTOR = '.ml-mermaid-source, .ml-codeblock-head, .ml-heading-link, .katex-mathml, script, style';
const MAX_MATCHES = 5000;

export interface SearchHost {
  article: HTMLElement;
  scroller: HTMLElement;
  /** Hits per heading id, for the table of contents. */
  onCounts(counts: Map<string, number> | undefined): void;
}

export class Search {
  readonly element: HTMLElement;
  private input: HTMLInputElement;
  private countEl: HTMLElement;
  private ranges: Range[] = [];
  private current = -1;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

  constructor(private readonly host: SearchHost) {
    this.element = el('div', 'ml-search');
    this.element.hidden = true;
    this.element.setAttribute('role', 'search');
    this.element.innerHTML = `
      <span class="ml-search-icon">${icon('search')}</span>
      <input type="text" class="ml-search-input" placeholder="Find in document" aria-label="Find in document" spellcheck="false">
      <span class="ml-search-count" aria-live="polite"></span>
      <button type="button" class="ml-icon-btn" data-dir="-1" title="Previous match (Shift+Enter)" aria-label="Previous match">${icon('arrow-up')}</button>
      <button type="button" class="ml-icon-btn" data-dir="1" title="Next match (Enter)" aria-label="Next match">${icon('arrow-down')}</button>
      <button type="button" class="ml-icon-btn" data-close title="Close (Escape)" aria-label="Close find">${icon('close')}</button>`;
    this.input = this.element.querySelector('input')!;
    this.countEl = this.element.querySelector('.ml-search-count')!;
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(true), 90);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    this.element.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.hasAttribute('data-close')) this.close();
      else this.step(Number(b.dataset.dir));
    });
    this.input.title = `Find (${modKey}+F)`;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    const selected = window.getSelection()?.toString().trim();
    this.element.hidden = false;
    document.body.classList.add('ml-search-open');
    if (selected && selected.length < 100 && !selected.includes('\n')) this.input.value = selected;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.run(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    document.body.classList.remove('ml-search-open');
    this.clear();
    this.host.onCounts(undefined);
    this.host.scroller.focus({ preventScroll: true });
  }

  /** Re-run after the document changed, keeping the reader near the same match. */
  refresh(): void {
    if (this.isOpen && this.input.value) this.run(false);
  }

  private clear(): void {
    this.ranges = [];
    this.current = -1;
    if (this.supported) {
      CSS.highlights.delete('ml-search');
      CSS.highlights.delete('ml-search-current');
    }
    this.countEl.textContent = '';
    this.element.classList.remove('ml-no-results');
  }

  private run(jump: boolean): void {
    const query = this.input.value;
    this.clear();
    if (!query) {
      this.host.onCounts(undefined);
      return;
    }
    this.ranges = findRanges(this.host.article, query);
    if (this.supported) CSS.highlights.set('ml-search', new Highlight(...this.ranges));
    this.host.onCounts(countBySection(this.host.article, this.ranges));
    if (this.ranges.length === 0) {
      this.countEl.textContent = 'No results';
      this.element.classList.add('ml-no-results');
      return;
    }
    // Start from the first match at or below the top of the viewport.
    const top = this.host.scroller.getBoundingClientRect().top;
    const first = this.ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
    this.select(first === -1 ? 0 : first, jump);
  }

  private step(dir: number): void {
    if (this.ranges.length === 0) {
      if (this.input.value) this.run(true);
      return;
    }
    this.select((this.current + dir + this.ranges.length) % this.ranges.length, true);
  }

  private select(i: number, scroll: boolean): void {
    this.current = i;
    const range = this.ranges[i];
    const capped = this.ranges.length >= MAX_MATCHES ? '+' : '';
    this.countEl.textContent = `${i + 1} of ${this.ranges.length}${capped}`;
    if (this.supported) CSS.highlights.set('ml-search-current', new Highlight(range));
    if (!scroll) return;
    // Open collapsed <details> that hide the match.
    for (let n: Node | null = range.startContainer; n; n = n.parentNode) {
      if (n instanceof HTMLDetailsElement && !n.open) n.open = true;
    }
    const r = range.getBoundingClientRect();
    const s = this.host.scroller;
    const sr = s.getBoundingClientRect();
    if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) {
      s.scrollTo({ top: s.scrollTop + r.top - sr.top - sr.height / 3 });
    }
    // Matches inside a horizontally scrolled table or code block.
    const box = (range.startContainer.parentElement as HTMLElement | null)?.closest<HTMLElement>('.ml-table-scroll, pre');
    if (box) {
      const br = box.getBoundingClientRect();
      if (r.left < br.left || r.right > br.right) box.scrollLeft += r.left - br.left - br.width / 3;
    }
  }
}

function findRanges(root: HTMLElement, query: string): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  const hay = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const out: Range[] = [];
  let from = 0;
  while (out.length < MAX_MATCHES) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    const range = document.createRange();
    const [sn, so] = locate(nodes, starts, at);
    const [en, eo] = locate(nodes, starts, at + needle.length, true);
    range.setStart(sn, so);
    range.setEnd(en, eo);
    out.push(range);
    from = at + Math.max(1, needle.length);
  }
  return out;
}

function locate(nodes: Text[], starts: number[], pos: number, isEnd = false): [Text, number] {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] < pos || (!isEnd && starts[mid] === pos)) lo = mid;
    else hi = mid - 1;
  }
  return [nodes[lo], pos - starts[lo]];
}

function countBySection(article: HTMLElement, ranges: Range[]): Map<string, number> {
  const headings = [...article.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  const counts = new Map<string, number>();
  let h = -1;
  const probe = document.createRange();
  for (const r of ranges) {
    while (h + 1 < headings.length) {
      probe.setStartBefore(headings[h + 1]);
      if (r.compareBoundaryPoints(Range.START_TO_START, probe) >= 0) h++;
      else break;
    }
    if (h >= 0) {
      const id = headings[h].id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
