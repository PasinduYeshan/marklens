// Small shared UI pieces: toast, pop-up menu, full-panel overlay.

import { el, icon } from './icons';

let toastEl: HTMLElement | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  if (!toastEl) {
    toastEl = el('div', 'ml-toast');
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  toastEl.className = `ml-toast ml-toast-${kind} ml-visible`;
  toastEl.innerHTML = `${icon(kind === 'error' ? 'warning' : 'check')}<span class="ml-toast-text"></span>`;
  toastEl.querySelector('.ml-toast-text')!.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove('ml-visible'), kind === 'error' ? 5000 : 1800);
}

export interface MenuItem {
  label: string;
  icon?: string;
  run: () => void;
}

let openMenu: { el: HTMLElement; trigger: HTMLElement; close: () => void } | undefined;

/** A small menu anchored under `trigger`. Closes on Escape, outside click or choice. */
export function showMenu(trigger: HTMLElement, items: MenuItem[]): void {
  if (openMenu?.trigger === trigger) {
    openMenu.close();
    return;
  }
  openMenu?.close();
  const menu = el('div', 'ml-menu');
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const b = el('button', 'ml-menu-item', `${item.icon ? icon(item.icon) : '<span class="ml-menu-spacer"></span>'}<span></span>`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.querySelector('span:last-child')!.textContent = item.label;
    b.addEventListener('click', () => {
      close();
      item.run();
    });
    menu.append(b);
  }
  const host = trigger.closest('.ml-overlay') ?? document.body;
  host.append(menu);
  const r = trigger.getBoundingClientRect();
  const mw = menu.offsetWidth;
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
  trigger.setAttribute('aria-expanded', 'true');

  const onDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && !trigger.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      trigger.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  function close() {
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    openMenu = undefined;
  }
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  openMenu = { el: menu, trigger, close };
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

export function closeMenus(): boolean {
  if (!openMenu) return false;
  openMenu.close();
  return true;
}

/**
 * A layer covering the whole panel (webviews can't use the Fullscreen API).
 * Returns the content host and a close function.
 */
export function openOverlay(title: string, onClose: () => void): { body: HTMLElement; tools: HTMLElement; close: () => void } {
  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = el('div', 'ml-overlay');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  const head = el('div', 'ml-overlay-head');
  const titleEl = el('div', 'ml-overlay-title');
  titleEl.textContent = title;
  const tools = el('div', 'ml-overlay-tools');
  const closeBtn = el('button', 'ml-icon-btn', icon('close'));
  closeBtn.type = 'button';
  closeBtn.title = 'Close (Esc)';
  closeBtn.setAttribute('aria-label', 'Close');
  head.append(titleEl, tools, closeBtn);
  const body = el('div', 'ml-overlay-body');
  overlay.append(head, body);
  document.body.append(overlay);
  document.body.classList.add('ml-has-overlay');

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (closeMenus()) return;
      e.preventDefault();
      close();
    }
  };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    onClose();
    overlay.remove();
    document.body.classList.remove('ml-has-overlay');
    previousFocus?.focus({ preventScroll: true });
  }
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  return { body, tools, close };
}
