// Pan and zoom for one element inside a clipping viewport. Used by diagrams and images.
//
// Inline, a plain wheel scrolls the page (never trap the reader); Ctrl/⌘+wheel or a
// trackpad pinch zooms. In the full-panel view a plain wheel pans, like a map.

export interface Size {
  w: number;
  h: number;
}

export type WheelMode = 'page' | 'pan';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

export class PanZoom {
  scale = 1;
  x = 0;
  y = 0;
  wheelMode: WheelMode = 'page';
  onChange?: () => void;
  private drag?: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean };

  constructor(
    readonly viewport: HTMLElement,
    readonly content: HTMLElement,
    public size: Size,
  ) {
    content.style.transformOrigin = '0 0';
    viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    viewport.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    viewport.addEventListener('pointermove', (e) => this.onPointerMove(e));
    viewport.addEventListener('pointerup', (e) => this.onPointerUp(e));
    viewport.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    viewport.addEventListener('dblclick', (e) => {
      const p = this.point(e);
      this.zoomAt(e.shiftKey ? 0.5 : 2, p.x, p.y, true);
    });
  }

  /** Scale that fits the whole content inside the viewport. */
  fitScale(allowUpscale = false): number {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if (!vw || !vh || !this.size.w || !this.size.h) return 1;
    const s = Math.min(vw / this.size.w, vh / this.size.h);
    return clamp(allowUpscale ? Math.min(s, 2) : Math.min(s, 1), MIN_SCALE, MAX_SCALE);
  }

  fit(allowUpscale = false): void {
    this.scale = this.fitScale(allowUpscale);
    this.center();
  }

  /** Actual size, centred horizontally and anchored to the top. */
  actualSize(): void {
    this.scale = 1;
    this.center();
    if (this.size.h > this.viewport.clientHeight) this.y = 0;
    this.apply();
  }

  zoomBy(factor: number): void {
    this.zoomAt(factor, this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, true);
  }

  zoomAt(factor: number, px: number, py: number, animate = false): void {
    const next = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    const k = next / this.scale;
    this.x = px - (px - this.x) * k;
    this.y = py - (py - this.y) * k;
    this.scale = next;
    this.apply(animate);
  }

  panBy(dx: number, dy: number, animate = false): void {
    this.x += dx;
    this.y += dy;
    this.apply(animate);
  }

  center(): void {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.x = (vw - this.size.w * this.scale) / 2;
    this.y = Math.max(0, (vh - this.size.h * this.scale) / 2);
    this.apply();
  }

  apply(animate = false): void {
    this.constrain();
    this.content.style.transition = animate ? 'transform 120ms ease-out' : '';
    this.content.style.transform = `translate(${round(this.x)}px, ${round(this.y)}px) scale(${round(this.scale, 4)})`;
    this.viewport.classList.toggle('ml-pannable', this.isPannable());
    this.onChange?.();
  }

  isPannable(): boolean {
    return this.size.w * this.scale > this.viewport.clientWidth + 1 || this.size.h * this.scale > this.viewport.clientHeight + 1;
  }

  /** Keep at least part of the content on screen. */
  private constrain(): void {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const w = this.size.w * this.scale;
    const h = this.size.h * this.scale;
    const margin = 48;
    this.x = w <= vw ? clamp(this.x, Math.min(0, vw - w), Math.max(0, vw - w)) : clamp(this.x, vw - w - margin, margin);
    this.y = h <= vh ? clamp(this.y, Math.min(0, vh - h), Math.max(0, vh - h)) : clamp(this.y, vh - h - margin, margin);
  }

  private onWheel(e: WheelEvent): void {
    const zoom = e.ctrlKey || e.metaKey;
    if (!zoom && this.wheelMode === 'page') return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
    if (zoom) {
      const p = this.point(e);
      // Pinch gestures send many small deltas; mouse wheels send few large ones.
      const rate = Math.abs(dy) < 50 ? 0.01 : 0.002;
      this.zoomAt(Math.exp(-dy * rate), p.x, p.y);
    } else {
      this.panBy(-dx, -dy);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, .ml-diagram-tools')) return;
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: this.x, oy: this.y, moved: false };
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.classList.add('ml-dragging');
    }
    this.x = d.ox + dx;
    this.y = d.oy + dy;
    this.apply();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.drag?.id !== e.pointerId) return;
    if (this.drag.moved) this.viewport.releasePointerCapture(e.pointerId);
    this.drag = undefined;
    this.viewport.classList.remove('ml-dragging');
  }

  private point(e: MouseEvent): { x: number; y: number } {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Arrow keys pan, +/- zoom, 0 fits, 1 shows actual size. Returns true if handled. */
  handleKey(e: KeyboardEvent, onFit: () => void): boolean {
    const step = e.shiftKey ? 160 : 48;
    switch (e.key) {
      case '+':
      case '=':
        this.zoomBy(1.25);
        return true;
      case '-':
      case '_':
        this.zoomBy(0.8);
        return true;
      case '0':
        onFit();
        return true;
      case '1':
        this.actualSize();
        return true;
      case 'ArrowLeft':
        this.panBy(step, 0, true);
        return true;
      case 'ArrowRight':
        this.panBy(-step, 0, true);
        return true;
      case 'ArrowUp':
        this.panBy(0, step, true);
        return true;
      case 'ArrowDown':
        this.panBy(0, -step, true);
        return true;
    }
    return false;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
