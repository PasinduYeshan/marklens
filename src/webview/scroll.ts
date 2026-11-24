// Maps between source lines (data-line) and scroll positions in the reader.

interface LineEl {
  line: number;
  el: HTMLElement;
}

export class LineMap {
  private cache?: LineEl[];

  constructor(
    private readonly scroller: HTMLElement,
    private readonly article: HTMLElement,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  private elements(): LineEl[] {
    if (this.cache) return this.cache;
    const out: LineEl[] = [];
    let last = -1;
    for (const el of this.article.querySelectorAll<HTMLElement>('[data-line]')) {
      const line = Number(el.dataset.line);
      // Skip nested elements on the same or an earlier line; keep the outermost block.
      if (!Number.isFinite(line) || line <= last) continue;
      if (el.offsetParent === null && !el.closest('details')) continue; // hidden
      out.push({ line, el });
      last = line;
    }
    return (this.cache = out);
  }

  /** Top of an element relative to the scrolled content. */
  top(el: Element): number {
    return el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
  }

  /** The block at the top of the viewport and how far (px) the viewport is into it. */
  position(): { line: number; offset: number; fractional: number } {
    const els = this.elements();
    const y = this.scroller.scrollTop;
    if (els.length === 0 || y <= 0) return { line: 0, offset: Math.max(0, y), fractional: 0 };
    let lo = 0;
    let hi = els.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.top(els[mid].el) <= y) lo = mid;
      else hi = mid - 1;
    }
    const cur = els[lo];
    const curTop = this.top(cur.el);
    const next = els[lo + 1];
    const offset = Math.max(0, y - curTop);
    let fractional = cur.line;
    if (next) {
      const span = this.top(next.el) - curTop;
      if (span > 0) fractional = cur.line + Math.min(1, offset / span) * (next.line - cur.line);
    }
    return { line: cur.line, offset: Math.round(offset), fractional };
  }

  /** Scroll position for a (possibly fractional) source line. */
  scrollTopFor(line: number): number {
    const els = this.elements();
    if (els.length === 0) return 0;
    let prev = els[0];
    let next: LineEl | undefined;
    for (const e of els) {
      if (e.line <= line) prev = e;
      else {
        next = e;
        break;
      }
    }
    const prevTop = this.top(prev.el);
    if (line <= prev.line || !next) {
      const extra = !next && line > prev.line ? (prev.el.offsetHeight * Math.min(1, line - prev.line)) / 4 : 0;
      return prevTop + extra;
    }
    const frac = (line - prev.line) / (next.line - prev.line);
    return prevTop + (this.top(next.el) - prevTop) * frac;
  }

  /** Scroll position for "line + offset px into that block" (history restore). */
  scrollTopForRestore(line: number, offset: number): number {
    const els = this.elements();
    const match = [...els].reverse().find((e) => e.line <= line);
    return match ? this.top(match.el) + offset : offset;
  }
}
