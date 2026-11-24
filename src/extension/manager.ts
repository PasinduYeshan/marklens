import * as vscode from 'vscode';
import { isMarkdownPath, type PersistedState } from '../shared/protocol';
import { followsActiveEditor } from './config';
import { MarkLensView, type ViewHost } from './view';

export const PREVIEW_VIEW_TYPE = 'marklens.preview';
export const READER_VIEW_TYPE = 'marklens.reader';

/**
 * Tracks every MarkLens view. At most one unpinned preview exists; it follows the
 * active Markdown editor. Pinned previews and reader tabs stay on their document.
 */
export class MarkLensManager implements ViewHost, vscode.Disposable {
  private readonly views = new Set<MarkLensView>();
  private followView?: MarkLensView;
  private activeView?: MarkLensView;
  private readonly disposables: vscode.Disposable[] = [];
  /** Documents switched from the reader to a text editor; ⌘E switches them back. */
  private readonly editingFromReader = new Set<string>();
  /** Line to open the next reader of a document at (set when switching from the editor). */
  private readonly pendingReaderLine = new Map<string, number>();

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.onActiveEditor(editor);
        void this.updateEditingContext(editor);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length === 0) return;
        for (const v of this.views) v.documentChanged(e.document);
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        const top = e.visibleRanges[0]?.start.line;
        if (top === undefined) return;
        const uri = e.textEditor.document.uri.toString();
        for (const v of this.views) if (v.currentUri?.toString() === uri && v.panel.visible) v.editorScrolled(top);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('marklens') || e.affectsConfiguration('editor.fontFamily')) {
          for (const v of this.views) v.sendConfig();
        }
      }),
    );
  }

  get active(): MarkLensView | undefined {
    return this.activeView;
  }

  /** Internal: a snapshot of every view, for integration tests. */
  describe(): object[] {
    return [...this.views].map((v) => ({
      mode: v.mode,
      pinned: v.pinned,
      following: v === this.followView,
      ready: v.isReady,
      uri: v.currentUri?.toString(),
      title: v.panel.title,
      canBack: v.canGoBack,
      stats: v.lastStats,
    }));
  }

  /** Internal: the focused view, or the most recently opened one. */
  latest(): MarkLensView | undefined {
    return this.activeView ?? [...this.views].pop();
  }

  // ---- Commands ----

  async openPreview(uri: vscode.Uri | undefined, toSide: boolean): Promise<void> {
    const target = uri ?? activeMarkdownUri();
    if (!target) {
      void vscode.window.showInformationMessage('Open a Markdown file first, then run MarkLens: Open Preview.');
      return;
    }
    if (this.followView) {
      this.followView.panel.reveal(undefined, true);
      await this.followView.open(target, 'push');
      return;
    }
    const column = toSide ? vscode.ViewColumn.Beside : (vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active);
    const panel = vscode.window.createWebviewPanel(PREVIEW_VIEW_TYPE, 'MarkLens', { viewColumn: column, preserveFocus: toSide }, panelOptions());
    this.followView = this.track(new MarkLensView(panel, this.extensionUri, this, 'preview', false, { uri: target }));
  }

  async openReader(uri: vscode.Uri | undefined): Promise<void> {
    const target = uri ?? activeMarkdownUri() ?? this.activeView?.currentUri;
    if (!target) {
      void vscode.window.showInformationMessage('Choose a Markdown file to open in the MarkLens Reader.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, READER_VIEW_TYPE);
  }

  openPinned(uri: vscode.Uri, fragment?: string): void {
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      'MarkLens',
      { viewColumn: this.activeView?.panel.viewColumn ?? vscode.ViewColumn.Beside, preserveFocus: false },
      panelOptions(),
    );
    this.track(new MarkLensView(panel, this.extensionUri, this, 'preview', true, { uri, fragment }));
  }

  togglePin(view: MarkLensView | undefined = this.activeView): void {
    if (!view || view.mode !== 'preview') return;
    if (view.pinned) {
      // Only one preview follows the editor: the previous follower becomes pinned.
      if (this.followView && this.followView !== view) this.followView.pinned = true;
      view.pinned = false;
      this.followView = view;
    } else {
      view.pinned = true;
      if (this.followView === view) this.followView = undefined;
    }
    void this.updateContext();
  }

  // ---- Restoring and the reader editor ----

  restorePreview(panel: vscode.WebviewPanel, state: PersistedState | undefined): void {
    const pinned = state?.pinned ?? false;
    const shouldFollow = !pinned && !this.followView;
    const view = this.track(new MarkLensView(panel, this.extensionUri, this, 'preview', !shouldFollow));
    if (shouldFollow) this.followView = view;
  }

  resolveReader(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const key = document.uri.toString();
    const line = this.pendingReaderLine.get(key);
    this.pendingReaderLine.delete(key);
    this.track(new MarkLensView(panel, this.extensionUri, this, 'reader', true, { uri: document.uri, line }));
  }

  // ---- Switching between reading and editing ----

  /** Reader → text editor in the same place, at the line being read. A preview opens the source instead. */
  edit(view: MarkLensView | undefined = this.activeView): void {
    if (!view) return;
    const uri = view.currentUri;
    if (!uri) return;
    const line = view.topLine;
    if (view.mode === 'preview') {
      void view.openSource(line);
      return;
    }
    void (async () => {
      const column = view.panel.viewColumn ?? vscode.ViewColumn.Active;
      const readerTab = findTab((input) => input instanceof vscode.TabInputCustom && input.viewType === READER_VIEW_TYPE, column, view.panel);
      const editor = await vscode.window.showTextDocument(uri, { viewColumn: column, preview: false });
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
      this.editingFromReader.add(uri.toString());
      if (readerTab) await vscode.window.tabGroups.close(readerTab, true);
      await this.updateEditingContext(editor);
    })();
  }

  /** Text editor → reader in the same place, at the editor's top line. */
  async read(uri?: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? (editor && isMarkdownDoc(editor.document) ? editor.document.uri : undefined);
    if (!target) {
      void vscode.window.showInformationMessage('Open a Markdown file first.');
      return;
    }
    const sameEditor = editor && editor.document.uri.toString() === target.toString() ? editor : undefined;
    const column = sameEditor?.viewColumn ?? vscode.ViewColumn.Active;
    const textTab = sameEditor
      ? findTab((input) => input instanceof vscode.TabInputText && input.uri.toString() === target.toString(), column)
      : undefined;
    if (sameEditor) this.pendingReaderLine.set(target.toString(), sameEditor.visibleRanges[0]?.start.line ?? 0);
    await vscode.commands.executeCommand('vscode.openWith', target, READER_VIEW_TYPE, { viewColumn: column, preview: false });
    this.editingFromReader.delete(target.toString());
    if (textTab) await vscode.window.tabGroups.close(textTab, true);
  }

  private async updateEditingContext(editor = vscode.window.activeTextEditor): Promise<void> {
    const on = !!editor && this.editingFromReader.has(editor.document.uri.toString());
    await vscode.commands.executeCommand('setContext', 'marklens.editingFromReader', on);
  }

  // ---- ViewHost ----

  onViewFocus(view: MarkLensView): void {
    this.activeView = view;
    void this.updateContext();
  }

  onViewDispose(view: MarkLensView): void {
    this.views.delete(view);
    if (this.followView === view) this.followView = undefined;
    if (this.activeView === view) this.activeView = undefined;
    void this.updateContext();
  }

  private track(view: MarkLensView): MarkLensView {
    this.views.add(view);
    view.panel.onDidChangeViewState(() => {
      if (!view.panel.active && this.activeView === view) {
        this.activeView = undefined;
        void this.updateContext();
      }
    });
    if (view.panel.active) this.onViewFocus(view);
    return view;
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || !this.followView || this.followView.pinned || !followsActiveEditor()) return;
    const doc = editor.document;
    if (doc.languageId !== 'markdown' && !isMarkdownPath(doc.uri.path)) return;
    void this.followView.open(doc.uri, 'push');
  }

  private async updateContext(): Promise<void> {
    const v = this.activeView;
    await vscode.commands.executeCommand('setContext', 'marklens.active', !!v);
    await vscode.commands.executeCommand('setContext', 'marklens.previewPinned', !!v && v.mode === 'preview' && v.pinned);
  }

  dispose(): void {
    for (const v of [...this.views]) v.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

export function panelOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
  // Context is retained so diagrams, zoom levels and scroll positions survive tab switches.
  return { enableScripts: true, retainContextWhenHidden: true, enableFindWidget: false };
}

function isMarkdownDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'markdown' || isMarkdownPath(doc.uri.path);
}

/** A tab in the given column whose input matches; for the reader, the tab of that panel. */
function findTab(
  match: (input: unknown) => boolean,
  column: vscode.ViewColumn,
  panel?: vscode.WebviewPanel,
): vscode.Tab | undefined {
  const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === column);
  const tabs = (group?.tabs ?? []).filter((t) => match(t.input));
  if (panel) return tabs.find((t) => t.isActive && t.label === panel.title) ?? tabs.find((t) => t.label === panel.title) ?? tabs[0];
  return tabs[0];
}

function activeMarkdownUri(): vscode.Uri | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && (doc.languageId === 'markdown' || isMarkdownPath(doc.uri.path))) return doc.uri;
  return undefined;
}
