import * as vscode from 'vscode';
import type { ViewConfig } from '../shared/protocol';

export function readConfig(): ViewConfig {
  const c = vscode.workspace.getConfiguration('marklens');
  const editorFont = vscode.workspace.getConfiguration('editor').get<string>('fontFamily', '');
  return {
    fontFamily: c.get('typography.fontFamily', ''),
    codeFontFamily: c.get('typography.codeFontFamily', '') || editorFont,
    fontSize: clamp(c.get('typography.fontSize', 15), 10, 28),
    lineHeight: clamp(c.get('typography.lineHeight', 1.65), 1.2, 2.2),
    contentWidth: c.get('layout.contentWidth', 'medium'),
    spacing: c.get('layout.spacing', 'comfortable'),
    tocVisible: c.get('toc.visible', true),
    tocDepth: clamp(c.get('toc.depth', 4), 1, 6),
    scrollSync: c.get('preview.scrollSync', true),
    mermaidTheme: c.get('mermaid.theme', 'auto'),
    breaks: c.get('markdown.breaks', false),
    theme: c.get('theme', 'auto'),
  };
}

export function followsActiveEditor(): boolean {
  return vscode.workspace.getConfiguration('marklens').get('preview.followActiveEditor', true);
}

const SETTING_KEYS: Record<string, string> = {
  fontSize: 'typography.fontSize',
  contentWidth: 'layout.contentWidth',
  tocVisible: 'toc.visible',
  theme: 'theme',
};

/** Writes a reading preference changed from the preview's own controls. */
export async function updateSetting(key: string, value: unknown): Promise<void> {
  const name = SETTING_KEYS[key];
  if (!name) return;
  await vscode.workspace.getConfiguration('marklens').update(name, value, vscode.ConfigurationTarget.Global);
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
