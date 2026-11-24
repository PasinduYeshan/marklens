// Codicons: the icon set VS Code itself uses, so the reader feels native.
export function icon(name: string): string {
  return `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
}

export function iconButton(name: string, label: string, extra = ''): string {
  return `<button type="button" class="ml-icon-btn" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export const isMac = navigator.platform.toUpperCase().includes('MAC');
export const modKey = isMac ? '⌘' : 'Ctrl';
