import * as vscode from 'vscode';
import { NavigationHistory, type HistoryEntry } from '../shared/history';
import { classifyLink } from '../shared/links';
import type { DocPayload, HostMessage, NavState, PersistedState, RenderStats, ScrollTarget, WebviewMessage } from '../shared/protocol';
import { readConfig, updateSetting } from './config';
import { log } from './log';

export type ViewMode = 'preview' | 'reader';

export interface ViewHost {
  /** Opens a location in a new pinned preview (Cmd/Ctrl+click on a link). */
  openPinned(uri: vscode.Uri, fragment?: string): void;
  togglePin(view: MarkLensView): void;
  /** Switch to editing the shown document. */
  edit(view: MarkLensView): void;
  onViewFocus(view: MarkLensView): void;
  onViewDispose(view: MarkLensView): void;
}

const decoder = new TextDecoder('utf-8');
const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'index.md'];

/**
 * One MarkLens webview: a side preview or a reader tab. Owns the navigation history,
 * reads documents (from open editors or disk), watches them and relays everything to
 * the webview, which only renders.
 */
export class MarkLensView implements vscode.Disposable {
  private history = new NavigationHistory();
  private ready = false;
  private disposed = false;
  private watcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];
  private updateTimer?: ReturnType<typeof setTimeout>;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private roots: vscode.Uri[];
  /** Last render report from the webview (tests and diagnostics). */
  lastStats?: RenderStats;
  /** Time until which editor scroll events are ignored, after the preview moved the editor. */
  suppressEditorSyncUntil = 0;

  constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly host: ViewHost,
    readonly mode: ViewMode,
    private pinnedFlag: boolean,
    private initial?: { uri: vscode.Uri; fragment?: string; line?: number },
  ) {
    this.roots = [vscode.Uri.joinPath(extensionUri, 'dist'), ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)];
    if (initial) this.addRoot(dirname(initial.uri));
    this.applyWebviewOptions();
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'tab-icon-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'tab-icon-dark.svg'),
    };
    panel.webview.html = this.html();

    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m)),
      panel.onDidChangeViewState(() => {
        if (panel.active) host.onViewFocus(this);
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  get pinned(): boolean {
    return this.mode === 'reader' || this.pinnedFlag;
  }

  set pinned(value: boolean) {
    this.pinnedFlag = value;
    this.updateTitle();
    this.postNav();
    this.schedulePersist();
  }

  get currentUri(): vscode.Uri | undefined {
    const cur = this.history.current;
    return cur ? vscode.Uri.parse(cur.uri) : undefined;
  }

  // ---- Public operations (commands and the manager) ----

  /** Shows a document. `push` adds a history entry; `replace` swaps the current one. */
  async open(uri: vscode.Uri, how: 'push' | 'replace', fragment?: string): Promise<void> {
    const cur = this.history.current;
    if (cur && cur.uri === uri.toString()) {
      if (fragment) {
        this.history.push(cur.uri, fragment);
        this.post({ type: 'scrollTo', scroll: { kind: 'fragment', fragment } });
        this.postNav();
      }
      return;
    }
    const entry = how === 'push' ? this.history.push(uri.toString(), fragment) : this.history.replace(uri.toString(), fragment);
    await this.showEntry(entry);
  }

  back(): void {
    this.go(() => this.history.back());
  }

  forward(): void {
    this.go(() => this.history.forward());
  }

  command(command: 'find' | 'toggleToc'): void {
    this.post({ type: 'command', command });
  }

  refresh(): void {
    const cur = this.history.current;
    if (cur) void this.showEntry(cur, { kind: 'keep' });
  }

  sendConfig(): void {
    this.post({ type: 'config', config: readConfig() });
  }

  /** The document's text changed in an editor (possibly unsaved). */
  documentChanged(doc: vscode.TextDocument): void {
    if (doc.uri.toString() !== this.history.current?.uri) return;
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.post({ type: 'update', uri: doc.uri.toString(), text: doc.getText() }), 120);
  }

  /** A visible editor of the shown document scrolled. */
  editorScrolled(line: number): void {
    if (Date.now() < this.suppressEditorSyncUntil) return;
    this.post({ type: 'syncToLine', line });
  }

  async openSource(line?: number): Promise<void> {
    const uri = this.currentUri;
    if (!uri) return;
    const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
    const column = visible?.viewColumn ?? this.sourceColumn();
    const doc = await vscode.workspace.openTextDocument(uri);
    const selection = line !== undefined ? new vscode.Range(line, 0, line, 0) : undefined;
    await vscode.window.showTextDocument(doc, { viewColumn: column, selection, preserveFocus: false });
  }

  // ---- Webview messages ----

  private async onMessage(m: WebviewMessage): Promise<void> {
    try {
      switch (m.type) {
        case 'ready':
          return this.onReady(m.state);
        case 'navigate':
          return await this.navigate(m.href, m.newTab === true);
        case 'back':
          return this.back();
        case 'forward':
          return this.forward();
        case 'position':
          this.history.updatePosition(m.line, m.offset);
          this.schedulePersist();
          return;
        case 'revealLine':
          return this.revealInEditor(m.line);
        case 'openSource':
          return await this.openSource(m.line);
        case 'edit':
          return this.host.edit(this);
        case 'togglePin':
          return this.host.togglePin(this);
        case 'copy':
          await vscode.env.clipboard.writeText(m.text);
          vscode.window.setStatusBarMessage(`$(check) ${m.label ?? 'Copied'}`, 2000);
          return;
        case 'save':
          return await this.save(m);
        case 'setting':
          return await updateSetting(m.key, m.value);
        case 'log':
          log(`[webview ${m.level}] ${m.message}`);
          return;
        case 'stats':
          this.lastStats = m.stats;
          return;
      }
    } catch (err) {
      log(`Error handling ${m.type}: ${String(err)}`);
      this.post({ type: 'error', message: String(err instanceof Error ? err.message : err) });
    }
  }

  private onReady(state?: PersistedState): void {
    const firstReady = !this.ready;
    this.ready = true;
    this.sendConfig();
    if (firstReady && state?.history?.entries?.length && !this.history.current) {
      this.history = NavigationHistory.from(state.history);
      if (this.mode === 'preview') this.pinnedFlag = state.pinned;
    } else if (!this.history.current && this.initial) {
      this.history.push(this.initial.uri.toString(), this.initial.fragment);
      if (this.initial.line) this.history.updatePosition(this.initial.line, 0);
    }
    this.initial = undefined;
    const cur = this.history.current;
    if (cur) void this.showEntry(cur, restoreTarget(cur));
    this.updateTitle();
  }

  /** Source line at the top of the reader, as last reported by the webview. */
  get topLine(): number {
    return this.history.current?.line ?? 0;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get canGoBack(): boolean {
    return this.history.canBack;
  }

  async navigate(href: string, newTab: boolean): Promise<void> {
    const current = this.history.current;
    if (!current) return;
    const root = this.workspaceRoot(vscode.Uri.parse(current.uri));
    const target = classifyLink(href, current.uri, root?.toString());
    switch (target.kind) {
      case 'fragment':
        this.history.push(current.uri, target.fragment);
        this.post({ type: 'scrollTo', scroll: { kind: 'fragment', fragment: target.fragment } });
        this.postNav();
        this.schedulePersist();
        return;
      case 'external':
        await vscode.env.openExternal(vscode.Uri.parse(target.url));
        return;
      case 'ignored':
        this.post({ type: 'error', message: `Not opened: ${target.reason}.` });
        return;
      case 'markdown': {
        const uri = vscode.Uri.parse(target.uri);
        if (!(await exists(uri))) {
          this.post({ type: 'error', message: `Can't find ${vscode.workspace.asRelativePath(uri)}.` });
          return;
        }
        if (newTab) return this.host.openPinned(uri, target.fragment);
        return this.open(uri, 'push', target.fragment);
      }
      case 'file': {
        const uri = vscode.Uri.parse(target.uri);
        const stat = await statOf(uri);
        if (!stat) {
          this.post({ type: 'error', message: `Can't find ${vscode.workspace.asRelativePath(uri)}.` });
          return;
        }
        if (stat.type & vscode.FileType.Directory) {
          for (const name of README_NAMES) {
            const readme = vscode.Uri.joinPath(uri, name);
            if (await exists(readme)) return newTab ? this.host.openPinned(readme) : this.open(readme, 'push');
          }
          await vscode.commands.executeCommand('revealInExplorer', uri);
          return;
        }
        const line = target.line !== undefined ? Math.max(0, target.line - 1) : undefined;
        await vscode.commands.executeCommand('vscode.open', uri, {
          viewColumn: this.sourceColumn(),
          selection: line !== undefined ? new vscode.Range(line, 0, line, 0) : undefined,
        } satisfies vscode.TextDocumentShowOptions);
        return;
      }
    }
  }

  private go(move: () => HistoryEntry | undefined): void {
    const before = this.history.current?.uri;
    const entry = move();
    if (!entry) return;
    if (entry.uri === before) {
      this.post({ type: 'scrollTo', scroll: restoreTarget(entry) });
      this.postNav();
      this.schedulePersist();
    } else {
      void this.showEntry(entry, restoreTarget(entry));
    }
  }

  private async showEntry(entry: HistoryEntry, scroll?: ScrollTarget): Promise<void> {
    const uri = vscode.Uri.parse(entry.uri);
    this.watch(uri);
    this.updateTitle();
    if (!this.ready) return; // onReady shows the current entry
    let text: string;
    try {
      text = await readText(uri);
    } catch (err) {
      this.post({ type: 'error', message: `Can't read ${vscode.workspace.asRelativePath(uri)}: ${String(err)}` });
      return;
    }
    if (this.addRoot(dirname(uri))) this.applyWebviewOptions();
    const target: ScrollTarget = scroll ?? (entry.fragment ? { kind: 'fragment', fragment: entry.fragment } : { kind: 'top' });
    this.post({ type: 'load', doc: this.payload(uri, text), scroll: target, nav: this.navState() });
    this.schedulePersist();
  }

  private payload(uri: vscode.Uri, text: string): DocPayload {
    const root = this.workspaceRoot(uri) ?? dirname(uri);
    const webview = this.panel.webview;
    return {
      uri: uri.toString(),
      name: basename(uri),
      path: vscode.workspace.asRelativePath(uri, true),
      text,
      baseHref: withSlash(webview.asWebviewUri(dirname(uri)).toString()),
      rootHref: withSlash(webview.asWebviewUri(root).toString()),
    };
  }

  private revealInEditor(line: number): void {
    if (!readConfig().scrollSync) return;
    const uri = this.history.current?.uri;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== uri) continue;
      this.suppressEditorSyncUntil = Date.now() + 400;
      const l = Math.min(Math.max(0, line), editor.document.lineCount - 1);
      editor.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.AtTop);
    }
  }

  private async save(m: Extract<WebviewMessage, { type: 'save' }>): Promise<void> {
    const dir = this.currentUri ? dirname(this.currentUri) : vscode.workspace.workspaceFolders?.[0]?.uri;
    const target = await vscode.window.showSaveDialog({
      defaultUri: dir ? vscode.Uri.joinPath(dir, m.suggestedName) : undefined,
      filters: { [m.filterName]: [m.extension] },
      saveLabel: 'Export',
    });
    if (!target) return;
    const bytes = m.encoding === 'base64' ? Buffer.from(m.data, 'base64') : new TextEncoder().encode(m.data);
    await vscode.workspace.fs.writeFile(target, bytes);
    const choice = await vscode.window.showInformationMessage(`Exported ${basename(target)}.`, 'Open');
    if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', target, { viewColumn: vscode.ViewColumn.Beside });
  }

  // ---- Helpers ----

  private watch(uri: vscode.Uri): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (uri.scheme === 'untitled') return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(uri), basename(uri)), true, false, true);
    watcher.onDidChange(async () => {
      if (uri.toString() !== this.history.current?.uri) return;
      // An open editor reports its own (possibly unsaved) text; disk only matters otherwise.
      if (vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString() && d.isDirty)) return;
      try {
        this.post({ type: 'update', uri: uri.toString(), text: await readText(uri) });
      } catch {
        /* deleted or unreadable; keep showing the last version */
      }
    });
    this.watcher = watcher;
  }

  private navState(): NavState {
    return { canBack: this.history.canBack, canForward: this.history.canForward, pinned: this.pinned, mode: this.mode };
  }

  private postNav(): void {
    this.post({ type: 'nav', nav: this.navState() });
  }

  private updateTitle(): void {
    const uri = this.currentUri;
    const name = uri ? basename(uri) : 'MarkLens';
    this.panel.title = this.mode === 'reader' ? name : this.pinned ? `${name} (pinned)` : `Preview ${name}`;
  }

  private schedulePersist(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.post({ type: 'persist', state: { history: this.history.snapshot(), pinned: this.pinnedFlag } });
    }, 400);
  }

  private sourceColumn(): vscode.ViewColumn {
    const col = this.panel.viewColumn ?? vscode.ViewColumn.One;
    return col > vscode.ViewColumn.One ? col - 1 : vscode.ViewColumn.Beside;
  }

  private workspaceRoot(uri: vscode.Uri): vscode.Uri | undefined {
    return vscode.workspace.getWorkspaceFolder(uri)?.uri;
  }

  private addRoot(dir: vscode.Uri): boolean {
    const s = withSlash(dir.toString());
    if (this.roots.some((r) => s.startsWith(withSlash(r.toString())))) return false;
    this.roots.push(dir);
    return true;
  }

  private applyWebviewOptions(): void {
    this.panel.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: this.roots };
  }

  private post(message: HostMessage): void {
    if (!this.disposed && (this.ready || message.type === 'config')) void this.panel.webview.postMessage(message);
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = makeNonce();
    const asset = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', p)).toString();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `media-src ${webview.cspSource} https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset('styles.css')}">
</head>
<body>
<div id="app"></div>
<script type="module" nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.updateTimer);
    clearTimeout(this.persistTimer);
    this.watcher?.dispose();
    for (const d of this.disposables) d.dispose();
    this.host.onViewDispose(this);
    this.panel.dispose();
  }
}

function restoreTarget(e: HistoryEntry): ScrollTarget {
  if (e.line > 0 || e.offset > 0) return { kind: 'restore', line: e.line, offset: e.offset };
  return e.fragment ? { kind: 'fragment', fragment: e.fragment } : { kind: 'top' };
}

export async function readText(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  return decoder.decode(await vscode.workspace.fs.readFile(uri));
}

async function statOf(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  if (vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString())) return true;
  return (await statOf(uri)) !== undefined;
}

export function dirname(uri: vscode.Uri): vscode.Uri {
  const path = uri.path.replace(/\/[^/]*$/, '') || '/';
  return uri.with({ path, query: '', fragment: '' });
}

export function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() || uri.path;
}

function withSlash(s: string): string {
  return s.endsWith('/') ? s : `${s}/`;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
