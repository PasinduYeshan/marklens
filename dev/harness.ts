// A fake extension host for developing the webview in a normal browser.
// Mirrors src/extension/view.ts closely enough to exercise navigation and history.

import { NavigationHistory, type HistoryEntry } from '../src/shared/history';
import { classifyLink } from '../src/shared/links';
import type { HostMessage, ScrollTarget, ViewConfig, WebviewMessage } from '../src/shared/protocol';

const WORKSPACE = 'file:///workspace/';
const params = new URLSearchParams(location.search);
document.body.className = params.get('theme') === 'dark' ? 'vscode-dark' : 'vscode-light';

let config: ViewConfig = {
  fontFamily: '',
  codeFontFamily: '',
  fontSize: 15,
  lineHeight: 1.65,
  contentWidth: 'medium',
  spacing: 'comfortable',
  tocVisible: true,
  tocDepth: 4,
  scrollSync: false,
  mermaidTheme: 'auto',
  breaks: false,
  theme: (params.get('mlTheme') as ViewConfig['theme']) ?? 'auto',
};

const history = new NavigationHistory();
let lastText = '';

function post(m: HostMessage): void {
  window.postMessage(m, '*');
}

function toHttp(uri: string): string {
  return `/${uri.slice(WORKSPACE.length)}`;
}

function dirOf(uri: string): string {
  return uri.replace(/[^/]*$/, '');
}

async function show(entry: HistoryEntry, scroll?: ScrollTarget): Promise<void> {
  const res = await fetch(toHttp(entry.uri), { cache: 'no-store' });
  if (!res.ok) {
    post({ type: 'error', message: `Can't find ${entry.uri.slice(WORKSPACE.length)}.` });
    return;
  }
  const text = await res.text();
  lastText = text;
  const name = entry.uri.split('/').pop()!;
  post({
    type: 'load',
    doc: {
      uri: entry.uri,
      name,
      path: entry.uri.slice(WORKSPACE.length),
      text,
      baseHref: `${location.origin}${toHttp(dirOf(entry.uri))}`,
      rootHref: `${location.origin}/`,
    },
    scroll: scroll ?? (entry.fragment ? { kind: 'fragment', fragment: entry.fragment } : { kind: 'top' }),
    nav: navState(),
  });
}

function navState() {
  return { canBack: history.canBack, canForward: history.canForward, pinned: false, mode: 'preview' as const };
}

function restore(e: HistoryEntry): ScrollTarget {
  if (e.line > 0 || e.offset > 0) return { kind: 'restore', line: e.line, offset: e.offset };
  return e.fragment ? { kind: 'fragment', fragment: e.fragment } : { kind: 'top' };
}

function go(move: () => HistoryEntry | undefined): void {
  const before = history.current?.uri;
  const e = move();
  if (!e) return;
  if (e.uri === before) {
    post({ type: 'scrollTo', scroll: restore(e) });
    post({ type: 'nav', nav: navState() });
  } else void show(e, restore(e));
}

async function handle(m: WebviewMessage): Promise<void> {
  (window as unknown as { __messages: WebviewMessage[] }).__messages.push(m);
  switch (m.type) {
    case 'ready': {
      post({ type: 'config', config });
      const start = `${WORKSPACE}${params.get('doc') ?? 'test-docs/index.md'}`;
      const [uri, fragment] = start.split('#');
      history.push(uri, fragment);
      await show(history.current!);
      return;
    }
    case 'navigate': {
      const cur = history.current!;
      const t = classifyLink(m.href, cur.uri, WORKSPACE);
      if (t.kind === 'fragment') {
        history.push(cur.uri, t.fragment);
        post({ type: 'scrollTo', scroll: { kind: 'fragment', fragment: t.fragment } });
        post({ type: 'nav', nav: navState() });
      } else if (t.kind === 'markdown') {
        if (t.uri === cur.uri) {
          history.push(cur.uri, t.fragment);
          post({ type: 'scrollTo', scroll: t.fragment ? { kind: 'fragment', fragment: t.fragment } : { kind: 'top' } });
          post({ type: 'nav', nav: navState() });
          return;
        }
        const ok = (await fetch(toHttp(t.uri), { method: 'HEAD', cache: 'no-store' })).ok;
        if (!ok) return post({ type: 'error', message: `Can't find ${t.uri.slice(WORKSPACE.length)}.` });
        await show(history.push(t.uri, t.fragment));
      } else if (t.kind === 'external') {
        window.open(t.url, '_blank', 'noopener');
      } else if (t.kind === 'file') {
        post({ type: 'error', message: `(harness) would open ${t.uri.slice(WORKSPACE.length)} in an editor` });
      } else {
        post({ type: 'error', message: `Not opened: ${t.reason}.` });
      }
      return;
    }
    case 'back':
      return go(() => history.back());
    case 'forward':
      return go(() => history.forward());
    case 'position':
      history.updatePosition(m.line, m.offset);
      return;
    case 'edit':
      post({ type: 'error', message: '(harness) would switch to the text editor' });
      return;
    case 'setting':
      config = { ...config, [m.key]: m.value };
      post({ type: 'config', config });
      return;
    case 'log':
      console[m.level === 'info' ? 'log' : m.level](`[webview] ${m.message}`);
      return;
    default:
      return;
  }
}

(window as unknown as { __MARKLENS_HARNESS__: boolean }).__MARKLENS_HARNESS__ = true;
(window as unknown as { __messages: WebviewMessage[] }).__messages = [];
let state: unknown;
(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (m: WebviewMessage) => setTimeout(() => void handle(m), 0),
  getState: () => state,
  setState: (s: unknown) => (state = s),
});

// Test hooks for the browser tools.
(window as unknown as { harness: unknown }).harness = {
  setTheme(theme: 'light' | 'dark') {
    document.body.className = theme === 'dark' ? 'vscode-dark' : 'vscode-light';
  },
  setConfig(patch: Partial<ViewConfig>) {
    config = { ...config, ...patch };
    post({ type: 'config', config });
  },
  history: () => history.snapshot(),
};

// Live reload: pick up edits to the current file.
setInterval(async () => {
  const cur = history.current;
  if (!cur) return;
  const res = await fetch(toHttp(cur.uri), { cache: 'no-store' }).catch(() => undefined);
  if (!res?.ok) return;
  const text = await res.text();
  if (text !== lastText) {
    lastText = text;
    post({ type: 'update', uri: cur.uri, text });
  }
}, 1000);
