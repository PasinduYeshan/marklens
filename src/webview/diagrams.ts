// Mermaid diagrams: rendered lazily (visible ones first), cached by source and theme,
// each with its own pan/zoom, a full-panel view, and SVG/PNG export.

import type { Mermaid, MermaidConfig } from 'mermaid';
import { el, icon, modKey } from './icons';
import { PanZoom } from './panzoom';
import { openOverlay, showMenu, toast } from './ui';

export interface DiagramHost {
  docName(): string;
  copy(text: string, label: string): void;
  save(name: string, data: string, encoding: 'utf8' | 'base64', filterName: string, ext: string): void;
  /** Called after a diagram changes the document's height. */
  layoutChanged(): void;
}

let mermaidPromise: Promise<Mermaid> | undefined;
function loadMermaid(): Promise<Mermaid> {
  return (mermaidPromise ??= import('mermaid').then((m) => m.default));
}

const svgCache = new Map<string, string>();
let renderSeq = 0;

const DIAGRAM_KEYS = [
  'flowchart', 'sequence', 'gantt', 'journey', 'timeline', 'class', 'state', 'er', 'pie', 'quadrantChart',
  'requirement', 'mindmap', 'gitGraph', 'c4', 'sankey', 'xyChart', 'block', 'packet', 'architecture', 'kanban', 'radar',
];

export class Diagrams {
  private pending: HTMLElement[] = [];
  private visible = new Set<HTMLElement>();
  private running = false;
  private theme = '';
  private observer: IntersectionObserver;

  constructor(
    private readonly host: DiagramHost,
    scroller: HTMLElement,
    private themeSetting: () => string,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const block = e.target as HTMLElement;
          if (e.isIntersecting) this.visible.add(block);
          else this.visible.delete(block);
        }
        void this.run();
      },
      { root: scroller, rootMargin: '800px 0px' },
    );
  }

  /** Queue new `.ml-mermaid` blocks under `root` for rendering. */
  process(root: ParentNode): void {
    for (const block of root.querySelectorAll<HTMLElement>('.ml-mermaid:not([data-state])')) {
      block.dataset.state = 'pending';
      block.style.minHeight = '120px';
      this.pending.push(block);
      this.observer.observe(block);
    }
    void this.run();
  }

  /** Re-render everything, e.g. after the color theme changed. */
  refreshTheme(): void {
    const theme = this.resolveTheme();
    if (theme === this.theme) return;
    // Keep the current drawing on screen until its re-themed version is ready.
    for (const block of document.querySelectorAll<HTMLElement>('.ml-mermaid[data-state="done"], .ml-mermaid[data-state="error"]')) {
      block.dataset.state = 'pending';
      block.dataset.refresh = '';
      this.pending.push(block);
    }
    this.process(document);
  }

  /** A Mermaid theme name, or "base:{…}" with colours derived from the reader's palette. */
  private resolveTheme(): string {
    const setting = this.themeSetting();
    if (setting && setting !== 'auto') return setting;
    return `base:${JSON.stringify(readerPalette())}`;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        this.pending = this.pending.filter((b) => b.isConnected && b.dataset.state === 'pending');
        if (this.pending.length === 0) break;
        const next = this.pending.find((b) => this.visible.has(b)) ?? this.pending[0];
        await this.renderBlock(next);
        // Yield so scrolling stays smooth between diagrams.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.running = false;
    }
  }

  private async renderBlock(block: HTMLElement): Promise<void> {
    block.dataset.state = 'rendering';
    const source = block.querySelector('.ml-mermaid-source')?.textContent ?? '';
    const theme = this.resolveTheme();
    const key = `${theme}\u0000${source}`;
    let svg = svgCache.get(key);
    let error: string | undefined;
    if (svg === undefined) {
      try {
        const mermaid = await loadMermaid();
        this.configure(mermaid, theme, true);
        const id = `ml-mermaid-${++renderSeq}`;
        try {
          svg = (await mermaid.render(id, source)).svg;
        } finally {
          document.getElementById(id)?.remove();
          document.getElementById(`d${id}`)?.remove();
        }
        if (svgCache.size > 200) svgCache.delete(svgCache.keys().next().value!);
        svgCache.set(key, svg);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    if (!block.isConnected) return;
    for (const child of [...block.children]) if (!child.classList.contains('ml-mermaid-source')) child.remove();
    block.style.minHeight = '';
    delete block.dataset.refresh;
    if (svg === undefined) {
      block.dataset.state = 'error';
      block.append(errorBox(error ?? 'Unknown error', source));
    } else {
      block.dataset.state = 'done';
      new DiagramView(block, svg, source, this.host, theme, (src) => this.renderForExport(src, theme));
    }
    this.host.layoutChanged();
  }

  private configure(mermaid: Mermaid, theme: string, htmlLabels: boolean): void {
    if (this.theme === theme && htmlLabels) return;
    const perDiagram = Object.fromEntries(DIAGRAM_KEYS.map((k) => [k, { useMaxWidth: false }]));
    const font = getComputedStyle(document.body).getPropertyValue('--ml-font-ui').trim() || 'sans-serif';
    const base = theme.startsWith('base:');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: (base ? 'base' : theme) as MermaidConfig['theme'],
      themeVariables: base ? JSON.parse(theme.slice(5)) : undefined,
      fontFamily: font,
      htmlLabels,
      ...perDiagram,
      flowchart: { useMaxWidth: false, htmlLabels },
    } as MermaidConfig);
    this.theme = htmlLabels ? theme : '';
  }

  /** SVG text labels only (no <foreignObject>), so it can be drawn to a canvas. */
  private async renderForExport(source: string, theme: string): Promise<string> {
    const mermaid = await loadMermaid();
    this.configure(mermaid, theme, false);
    const id = `ml-export-${++renderSeq}`;
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      this.configure(mermaid, theme, true);
    }
  }
}

// ---- Diagram colours from the reader's theme ----

type Rgb = [number, number, number];

function cssColor(expr: string): Rgb {
  const probe = document.createElement('span');
  probe.style.color = expr;
  probe.style.display = 'none';
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const nums = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  // "color(srgb r g b)" uses 0–1 channels; "rgb(r, g, b)" uses 0–255.
  return value.startsWith('color(') ? [nums[0] * 255, nums[1] * 255, nums[2] * 255] : [nums[0], nums[1], nums[2]];
}

function mix(a: Rgb, b: Rgb, amountOfA: number): Rgb {
  return [0, 1, 2].map((i) => a[i] * amountOfA + b[i] * (1 - amountOfA)) as Rgb;
}

function hex(c: Rgb): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Calm, theme-matched diagram colours: tinted nodes, accent borders and lines. */
function readerPalette(): Record<string, string | boolean> {
  const bg = cssColor('var(--ml-bg)');
  const fg = cssColor('var(--ml-fg)');
  const accent = cssColor('var(--ml-accent)');
  const amber = cssColor('var(--ml-warning)');
  const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 128;
  const node = mix(accent, mix(fg, bg, dark ? 0.06 : 0.02), dark ? 0.1 : 0.07);
  const border = mix(accent, bg, dark ? 0.7 : 0.75);
  const line = mix(accent, fg, 0.65);
  const soft = mix(fg, bg, dark ? 0.08 : 0.05);
  const cluster = mix(fg, bg, dark ? 0.03 : 0.025);
  const clusterBorder = mix(fg, bg, 0.22);
  return {
    darkMode: dark,
    background: hex(bg),
    fontSize: '14px',
    primaryColor: hex(node),
    primaryBorderColor: hex(border),
    primaryTextColor: hex(fg),
    secondaryColor: hex(soft),
    secondaryBorderColor: hex(clusterBorder),
    secondaryTextColor: hex(fg),
    tertiaryColor: hex(cluster),
    tertiaryBorderColor: hex(clusterBorder),
    tertiaryTextColor: hex(fg),
    mainBkg: hex(node),
    nodeBorder: hex(border),
    textColor: hex(fg),
    titleColor: hex(fg),
    lineColor: hex(line),
    defaultLinkColor: hex(line),
    clusterBkg: hex(cluster),
    clusterBorder: hex(clusterBorder),
    edgeLabelBackground: hex(bg),
    noteBkgColor: hex(mix(amber, bg, dark ? 0.14 : 0.12)),
    noteBorderColor: hex(mix(amber, bg, 0.55)),
    noteTextColor: hex(fg),
    actorBkg: hex(node),
    actorBorder: hex(border),
    actorTextColor: hex(fg),
    actorLineColor: hex(mix(fg, bg, 0.3)),
    signalColor: hex(fg),
    signalTextColor: hex(fg),
    labelBoxBkgColor: hex(node),
    labelBoxBorderColor: hex(border),
    labelTextColor: hex(fg),
    loopTextColor: hex(fg),
    activationBkgColor: hex(soft),
    activationBorderColor: hex(border),
    sequenceNumberColor: hex(bg),
  };
}

function errorBox(message: string, source: string): HTMLElement {
  const box = el('div', 'ml-diagram-error');
  box.innerHTML = `<div class="ml-diagram-error-title">${icon('warning')}<span>This Mermaid diagram has an error</span></div><pre class="ml-diagram-error-msg"></pre><details><summary>Show source</summary><pre></pre></details>`;
  box.querySelector('.ml-diagram-error-msg')!.textContent = message.trim().split('\n').slice(0, 8).join('\n');
  box.querySelector('details pre')!.textContent = source;
  return box;
}

let diagramCount = 0;

class DiagramView {
  private pz: PanZoom;
  private figure: HTMLElement;
  private viewport: HTMLElement;
  private tools: HTMLElement;
  private pct: HTMLElement;
  private svg: SVGSVGElement;
  private adjusted = false;
  private overlay?: { close: () => void };
  private readonly index = ++diagramCount;

  constructor(
    block: HTMLElement,
    svgText: string,
    private readonly source: string,
    private readonly host: DiagramHost,
    private readonly theme: string,
    private readonly exportSvg: (src: string) => Promise<string>,
  ) {
    this.figure = el('figure', 'ml-diagram');
    this.viewport = el('div', 'ml-diagram-viewport');
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute('role', 'img');
    const canvas = el('div', 'ml-diagram-canvas', svgText);
    this.svg = canvas.querySelector('svg')!;
    const size = naturalSize(this.svg);
    this.svg.setAttribute('width', String(size.w));
    this.svg.setAttribute('height', String(size.h));
    this.svg.style.maxWidth = 'none';
    this.viewport.setAttribute('aria-label', `${diagramType(this.svg)} diagram. ${modKey}+scroll or +/- to zoom, drag or arrow keys to pan.`);
    this.viewport.append(canvas);

    this.tools = el('div', 'ml-diagram-tools');
    this.pct = el('span', 'ml-diagram-pct');
    this.tools.append(
      this.button('zoom-out', 'Zoom out (−)', () => this.zoom(0.8)),
      this.pct,
      this.button('zoom-in', 'Zoom in (+)', () => this.zoom(1.25)),
      this.textButton('Fit', 'Fit to view (0)', () => this.fit()),
      this.textButton('1:1', 'Actual size (1)', () => this.actual()),
      this.button('screen-full', 'Expand to full panel (F)', () => this.toggleExpand(), 'ml-expand'),
      this.button('ellipsis', 'More actions', (b) => this.menu(b)),
    );
    this.figure.append(this.viewport, this.tools);
    block.append(this.figure);

    this.pz = new PanZoom(this.viewport, canvas, size);
    this.pz.onChange = () => {
      this.pct.textContent = `${Math.round(this.pz.scale * 100)}%`;
    };
    this.viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) this.adjusted = true;
    });
    this.viewport.addEventListener('pointerdown', () => (this.adjusted = true));
    this.viewport.addEventListener('keydown', (e) => this.onKey(e));
    this.layoutInline();

    let lastWidth = this.figure.clientWidth;
    new ResizeObserver(() => {
      const w = this.figure.clientWidth;
      if (this.overlay || w === lastWidth || !w) return;
      lastWidth = w;
      if (!this.adjusted) this.layoutInline();
    }).observe(this.figure);
  }

  /** Inline: fit the width (never enlarge) and size the viewport to the diagram. */
  private layoutInline(): void {
    const width = this.figure.clientWidth || 600;
    const s = Math.min(1, width / this.pz.size.w);
    this.viewport.style.height = `${Math.max(64, Math.ceil(this.pz.size.h * s) + 2)}px`;
    this.pz.scale = s;
    this.pz.center();
  }

  private zoom(f: number): void {
    this.adjusted = true;
    this.pz.zoomBy(f);
  }

  private fit(): void {
    this.adjusted = false;
    if (this.overlay) this.pz.fit(true);
    else this.layoutInline();
  }

  private actual(): void {
    this.adjusted = true;
    this.pz.actualSize();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      this.toggleExpand();
      return;
    }
    if (this.pz.handleKey(e, () => this.fit())) {
      this.adjusted = e.key !== '0';
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private toggleExpand(): void {
    if (this.overlay) {
      this.overlay.close();
      return;
    }
    const slot = document.createComment('diagram');
    this.viewport.replaceWith(slot);
    const ov = openOverlay(`${diagramType(this.svg)} diagram`, () => {
      slot.replaceWith(this.viewport);
      this.figure.append(this.tools);
      this.figure.classList.remove('ml-expanded');
      this.overlay = undefined;
      this.pz.wheelMode = 'page';
      this.viewport.style.height = this.savedHeight;
      this.tools.querySelector('.ml-expand')!.innerHTML = icon('screen-full');
      this.fit();
      this.viewport.focus({ preventScroll: true });
    });
    this.savedHeight = this.viewport.style.height;
    this.viewport.style.height = '';
    ov.body.append(this.viewport);
    ov.tools.append(this.tools);
    this.tools.querySelector('.ml-expand')!.innerHTML = icon('screen-normal');
    this.overlay = ov;
    this.pz.wheelMode = 'pan';
    requestAnimationFrame(() => {
      this.pz.fit(true);
      this.viewport.focus({ preventScroll: true });
    });
  }
  private savedHeight = '';

  private menu(trigger: HTMLElement): void {
    showMenu(trigger, [
      { label: 'Copy Mermaid source', icon: 'copy', run: () => this.host.copy(this.source, 'Mermaid source copied') },
      { label: 'Copy as PNG image', icon: 'file-media', run: () => void this.copyPng() },
      { label: 'Export as SVG…', icon: 'export', run: () => this.saveSvg() },
      { label: 'Export as PNG…', icon: 'export', run: () => void this.savePng() },
    ]);
  }

  private fileBase(): string {
    return `${this.host.docName().replace(/\.[^.]+$/, '')}-diagram-${this.index}`;
  }

  private background(): string {
    return getComputedStyle(document.body).getPropertyValue('--ml-bg').trim() || (this.theme === 'dark' ? '#1e1e1e' : '#ffffff');
  }

  private saveSvg(): void {
    this.host.save(`${this.fileBase()}.svg`, serializeSvg(this.svg, this.background()), 'utf8', 'SVG image', 'svg');
  }

  private async pngDataUrl(): Promise<string> {
    const bg = this.background();
    try {
      return await rasterize(serializeSvg(this.svg, bg), this.pz.size, bg);
    } catch {
      // HTML labels (<foreignObject>) taint the canvas; re-render with SVG text labels.
      const holder = el('div', '', await this.exportSvg(this.source));
      const svg = holder.querySelector('svg')!;
      return rasterize(serializeSvg(svg, bg), naturalSize(svg), bg);
    }
  }

  private async savePng(): Promise<void> {
    try {
      const url = await this.pngDataUrl();
      this.host.save(`${this.fileBase()}.png`, url.slice(url.indexOf(',') + 1), 'base64', 'PNG image', 'png');
    } catch (err) {
      toast(`Couldn't export PNG: ${String(err)}`, 'error');
    }
  }

  private async copyPng(): Promise<void> {
    try {
      const url = await this.pngDataUrl();
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Diagram copied as PNG');
    } catch (err) {
      toast(`Couldn't copy the image: ${String(err)}`, 'error');
    }
  }

  private button(name: string, label: string, run: (b: HTMLButtonElement) => void, cls = ''): HTMLButtonElement {
    const b = el('button', `ml-icon-btn ${cls}`.trim(), icon(name));
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => run(b));
    return b;
  }

  private textButton(text: string, label: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'ml-text-btn');
    b.type = 'button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', run);
    return b;
  }
}

function naturalSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: Math.ceil(vb.width), h: Math.ceil(vb.height) };
  const w = parseFloat(svg.getAttribute('width') ?? '') || 600;
  const h = parseFloat(svg.getAttribute('height') ?? '') || 400;
  return { w, h };
}

function diagramType(svg: SVGSVGElement): string {
  const t = svg.getAttribute('aria-roledescription') ?? 'Mermaid';
  const name = t.replace(/[-_]?v\d+$/i, '').replace(/[-_]/g, ' ').replace(/diagram$/i, '').trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function serializeSvg(svg: SVGSVGElement, background: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { w, h } = naturalSize(svg);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.style.backgroundColor = background;
  clone.style.maxWidth = '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

async function rasterize(svgText: string, size: { w: number; h: number }, background: string): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await img.decode();
  const scale = Math.min(3, Math.max(1, 4096 / Math.max(size.w, size.h)), 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(size.w * scale);
  canvas.height = Math.ceil(size.h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png'); // throws SecurityError if the canvas is tainted
}
