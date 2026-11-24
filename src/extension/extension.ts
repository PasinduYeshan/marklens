import * as vscode from 'vscode';
import type { PersistedState } from '../shared/protocol';
import { initLog } from './log';
import { MarkLensManager, PREVIEW_VIEW_TYPE, READER_VIEW_TYPE, panelOptions } from './manager';

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  const manager = new MarkLensManager(context.extensionUri);
  context.subscriptions.push(manager);

  const onActive = (fn: (view: NonNullable<MarkLensManager['active']>) => void) => () => {
    const view = manager.active;
    if (view) fn(view);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('marklens.openPreviewToSide', (uri?: vscode.Uri) => manager.openPreview(asUri(uri), true)),
    vscode.commands.registerCommand('marklens.openPreview', (uri?: vscode.Uri) => manager.openPreview(asUri(uri), false)),
    vscode.commands.registerCommand('marklens.openReader', (uri?: vscode.Uri) => manager.openReader(asUri(uri))),
    vscode.commands.registerCommand('marklens.openSource', onActive((v) => void v.openSource())),
    vscode.commands.registerCommand('marklens.pin', () => manager.togglePin()),
    vscode.commands.registerCommand('marklens.unpin', () => manager.togglePin()),
    vscode.commands.registerCommand('marklens.back', onActive((v) => v.back())),
    vscode.commands.registerCommand('marklens.forward', onActive((v) => v.forward())),
    vscode.commands.registerCommand('marklens.find', onActive((v) => v.command('find'))),
    vscode.commands.registerCommand('marklens.toggleToc', onActive((v) => v.command('toggleToc'))),
    vscode.commands.registerCommand('marklens.refresh', onActive((v) => v.refresh())),
    vscode.commands.registerCommand('marklens.edit', () => manager.edit()),
    vscode.commands.registerCommand('marklens.read', (uri?: vscode.Uri) => manager.read(asUri(uri))),

    // Internal commands used by the integration tests; not contributed to the palette.
    vscode.commands.registerCommand('_marklens.describe', () => manager.describe()),
    vscode.commands.registerCommand('_marklens.navigate', (href: string) => manager.latest()?.navigate(href, false)),
    vscode.commands.registerCommand('_marklens.back', () => manager.latest()?.back()),

    vscode.window.registerWebviewPanelSerializer(PREVIEW_VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: PersistedState | undefined) {
        panel.webview.options = panelOptions();
        manager.restorePreview(panel, state);
      },
    }),

    vscode.window.registerCustomEditorProvider(
      READER_VIEW_TYPE,
      {
        resolveCustomTextEditor(document, panel) {
          manager.resolveReader(document, panel);
        },
      },
      { webviewOptions: { retainContextWhenHidden: true, enableFindWidget: false }, supportsMultipleEditorsPerDocument: true },
    ),
  );
}

export function deactivate(): void {
  /* views are disposed through context.subscriptions */
}

function asUri(arg: unknown): vscode.Uri | undefined {
  return arg instanceof vscode.Uri ? arg : undefined;
}
