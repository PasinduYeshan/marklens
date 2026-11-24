import type { HostMessage, PersistedState, WebviewMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi = acquireVsCodeApi();

/** True inside the browser dev harness rather than VS Code. */
export const isHarness = (window as { __MARKLENS_HARNESS__?: boolean }).__MARKLENS_HARNESS__ === true;

export function send(message: WebviewMessage): void {
  api.postMessage(message);
}

export function onMessage(handler: (message: HostMessage) => void): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as HostMessage | undefined;
    if (data && typeof data === 'object' && typeof data.type === 'string') handler(data);
  });
}

/** UI-only state the webview keeps for itself (merged with the host's persisted state). */
export interface UiState {
  tocWidth?: number;
  tocCollapsed?: string[];
}

interface SavedState {
  host?: PersistedState;
  ui?: UiState;
}

function saved(): SavedState {
  const s = api.getState();
  return s && typeof s === 'object' ? (s as SavedState) : {};
}

export function hostState(): PersistedState | undefined {
  return saved().host;
}

export function saveHostState(host: PersistedState): void {
  api.setState({ ...saved(), host });
}

export function uiState(): UiState {
  return saved().ui ?? {};
}

export function saveUiState(patch: UiState): void {
  const s = saved();
  api.setState({ ...s, ui: { ...s.ui, ...patch } });
}
