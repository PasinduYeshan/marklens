import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLog(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('MarkLens', { log: true });
  context.subscriptions.push(channel);
}

export function log(message: string): void {
  channel?.info(message);
}
