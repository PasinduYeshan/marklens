// Integration checks in a real VS Code window: the webview loads under VS Code's CSP,
// renders documents and diagrams, navigates between files, follows the editor, opens
// as a standalone reader and picks up unsaved edits.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { RenderStats } from '../../src/shared/protocol';

interface ViewInfo {
  mode: 'preview' | 'reader';
  pinned: boolean;
  following: boolean;
  ready: boolean;
  uri?: string;
  title: string;
  canBack: boolean;
  stats?: RenderStats;
}

const root = vscode.workspace.workspaceFolders![0].uri;
const file = (p: string) => vscode.Uri.joinPath(root, p);

async function views(): Promise<ViewInfo[]> {
  return (await vscode.commands.executeCommand<ViewInfo[]>('_marklens.describe')) ?? [];
}

async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false>, timeout = 30000): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    const v = await probe();
    if (v) return v;
    last = await views();
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${what}. Views: ${JSON.stringify(last, null, 2)}`);
}

const settled = (s?: RenderStats) => !!s && s.diagramsDone + s.diagramsFailed === s.diagrams;

const tests: [string, () => Promise<void>][] = [
  [
    'side preview opens and renders the active file',
    async () => {
      await vscode.window.showTextDocument(file('index.md'));
      await vscode.commands.executeCommand('marklens.openPreviewToSide');
      const v = await waitFor('preview of index.md', async () =>
        (await views()).find((x) => x.mode === 'preview' && x.uri?.endsWith('/index.md') && x.stats?.uri.endsWith('/index.md')),
      );
      assert.equal(v.following, true);
      assert.equal(v.stats!.headings, 4);
      assert.equal(v.title, 'Preview index.md');
    },
  ],
  [
    'links open other documents in the preview and Mermaid renders',
    async () => {
      await vscode.commands.executeCommand('_marklens.navigate', 'architecture.md#data-flow');
      const v = await waitFor('architecture diagrams', async () =>
        (await views()).find((x) => x.uri?.endsWith('/architecture.md') && x.stats?.uri.endsWith('/architecture.md') && settled(x.stats) && x.stats.diagrams > 0),
      );
      assert.equal(v.stats!.diagrams, 6);
      assert.equal(v.stats!.diagramsDone, 5, 'five valid diagrams render');
      assert.equal(v.stats!.diagramsFailed, 1, 'the broken diagram shows an error');
      assert.equal(v.canBack, true);
      assert.equal(vscode.window.activeTextEditor?.document.uri.path.endsWith('/index.md'), true, 'the source editor did not change');
    },
  ],
  [
    'back returns to the previous document',
    async () => {
      await vscode.commands.executeCommand('_marklens.back');
      await waitFor('back to index.md', async () => (await views()).find((x) => x.mode === 'preview' && x.stats?.uri.endsWith('/index.md')));
    },
  ],
  [
    'folder links open the folder README',
    async () => {
      await vscode.commands.executeCommand('_marklens.navigate', 'reference/');
      await waitFor('reference/README.md', async () => (await views()).find((x) => x.stats?.uri.endsWith('/reference/README.md')));
    },
  ],
  [
    'the unpinned preview follows the active editor',
    async () => {
      await vscode.window.showTextDocument(file('security-report.md'), { viewColumn: vscode.ViewColumn.One });
      const v = await waitFor('security report', async () =>
        (await views()).find((x) => x.following && x.stats?.uri.endsWith('/security-report.md') && settled(x.stats)),
      );
      assert.equal(v.stats!.diagramsDone, 1, 'the gantt chart renders');
    },
  ],
  [
    'unsaved edits show up live',
    async () => {
      const editor = await vscode.window.showTextDocument(file('security-report.md'), { viewColumn: vscode.ViewColumn.One });
      const before = (await views()).find((x) => x.following)!.stats!.headings;
      await editor.edit((e) => e.insert(new vscode.Position(editor.document.lineCount, 0), '\n## Added while testing\n'));
      await waitFor('new heading', async () => (await views()).find((x) => x.following && x.stats?.headings === before + 1));
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    },
  ],
  [
    'Edit switches the reader tab to a text editor in place, and Read switches back',
    async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const uri = file('reference/api.md');
      await vscode.commands.executeCommand('vscode.openWith', uri, 'marklens.reader');
      await waitFor('reader of api.md', async () => (await views()).find((x) => x.mode === 'reader' && x.stats?.uri.endsWith('/reference/api.md')));
      const tabs = () => vscode.window.tabGroups.activeTabGroup.tabs;
      const isText = (t: vscode.Tab) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString();
      const isReader = (t: vscode.Tab) => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'marklens.reader';

      await vscode.commands.executeCommand('marklens.edit');
      await waitFor('text editor replaces the reader', async () => tabs().some(isText) && !tabs().some(isReader));
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());
      assert.equal(tabs().length, 1, 'one tab, edited in place');

      await vscode.commands.executeCommand('marklens.read');
      await waitFor('reader replaces the text editor', async () => tabs().some(isReader) && !tabs().some(isText));
      await waitFor('reader rendered', async () => (await views()).find((x) => x.mode === 'reader' && x.stats?.uri.endsWith('/reference/api.md')));
      assert.equal(tabs().length, 1, 'one tab, read in place');
    },
  ],
  [
    'the reader opens a file without a source editor',
    async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.openWith', file('large.md'), 'marklens.reader');
      const v = await waitFor('reader of large.md', async () =>
        (await views()).find((x) => x.mode === 'reader' && x.stats?.uri.endsWith('/large.md') && settled(x.stats)),
      );
      assert.equal(v.stats!.headings, 481);
      assert.equal(v.stats!.diagramsDone, 6);
      assert.equal(vscode.window.visibleTextEditors.length, 0, 'no text editor was opened');
    },
  ],
];

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    const start = Date.now();
    try {
      await fn();
      console.log(`  ✓ ${name} (${Date.now() - start} ms)`);
    } catch (err) {
      console.log(`  ✗ ${name}\n    ${String(err instanceof Error ? err.stack : err).split('\n').join('\n    ')}`);
      failures.push(name);
    }
  }
  console.log(`\n${tests.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
}
