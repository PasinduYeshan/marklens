import type { HistorySnapshot } from './history';

// Messages between the extension host and the MarkLens webview.
// The extension owns documents, files and history; the webview owns rendering and UI.

export interface ViewConfig {
  fontFamily: string;
  codeFontFamily: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: 'narrow' | 'medium' | 'wide' | 'full';
  spacing: 'compact' | 'comfortable' | 'relaxed';
  tocVisible: boolean;
  tocDepth: number;
  scrollSync: boolean;
  mermaidTheme: 'auto' | 'default' | 'neutral' | 'dark' | 'forest';
  breaks: boolean;
  /** 'auto' follows the VS Code color theme. */
  theme: 'auto' | 'light' | 'paper' | 'dark';
}

export interface DocPayload {
  /** Document URI as a string (file:, untitled:, vscode-vfs: …). */
  uri: string;
  /** Short display name, e.g. "design.md". */
  name: string;
  /** Path relative to the workspace, for the breadcrumb and tooltips. */
  path: string;
  text: string;
  /** Webview URI of the document's folder, ending in "/", used to resolve images. */
  baseHref: string;
  /** Webview URI of the workspace root, ending in "/", used for "/absolute" image paths. */
  rootHref: string;
}

/** Where to put the reader after a document is shown. */
export type ScrollTarget =
  | { kind: 'top' }
  | { kind: 'fragment'; fragment: string }
  | { kind: 'restore'; line: number; offset: number }
  | { kind: 'keep' };

export interface NavState {
  canBack: boolean;
  canForward: boolean;
  pinned: boolean;
  /** "preview" follows the editor unless pinned; "reader" is a standalone editor tab. */
  mode: 'preview' | 'reader';
}

export type HostMessage =
  | { type: 'load'; doc: DocPayload; scroll: ScrollTarget; nav: NavState }
  | { type: 'update'; uri: string; text: string }
  | { type: 'config'; config: ViewConfig }
  | { type: 'nav'; nav: NavState }
  | { type: 'scrollTo'; scroll: ScrollTarget }
  | { type: 'syncToLine'; line: number }
  | { type: 'command'; command: 'find' | 'toggleToc' }
  | { type: 'error'; message: string }
  | { type: 'persist'; state: PersistedState };

export type WebviewMessage =
  /** Sent on start; carries the webview's saved state after a reload or restart. */
  | { type: 'ready'; state?: PersistedState }
  /** A link was activated. `href` is exactly as written in the document. */
  | { type: 'navigate'; href: string; newTab?: boolean }
  | { type: 'back' }
  | { type: 'forward' }
  /** The reader's position, reported after scrolling settles. */
  | { type: 'position'; line: number; offset: number }
  /** The user scrolled the preview; the editor should follow (scroll sync). */
  | { type: 'revealLine'; line: number }
  | { type: 'openSource'; line?: number }
  | { type: 'togglePin' }
  /** Edit the shown document: the reader tab becomes a text editor; a preview opens the source. */
  | { type: 'edit' }
  | { type: 'copy'; text: string; label?: string }
  | { type: 'save'; suggestedName: string; data: string; encoding: 'utf8' | 'base64'; filterName: string; extension: string }
  | { type: 'setting'; key: 'fontSize' | 'contentWidth' | 'tocVisible' | 'theme'; value: unknown }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  /** What is on screen; used by tests and the output channel. */
  | { type: 'stats'; stats: RenderStats };

export interface RenderStats {
  uri: string;
  blocks: number;
  headings: number;
  diagrams: number;
  diagramsDone: number;
  diagramsFailed: number;
}

/** Saved with the webview so history survives reloads and window restarts. */
export interface PersistedState {
  history: HistorySnapshot;
  pinned: boolean;
}

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn'];

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
