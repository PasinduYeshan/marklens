// Browser-style back/forward history for a MarkLens view. Pure, so the extension
// host and the browser dev harness share it and it can be unit tested.

export interface HistoryEntry {
  uri: string;
  /** Source line at the top of the viewport, and pixel offset within that block. */
  line: number;
  offset: number;
  /** Heading anchor the entry was opened at, if any. */
  fragment?: string;
}

export interface HistorySnapshot {
  entries: HistoryEntry[];
  index: number;
}

const MAX_ENTRIES = 100;

export class NavigationHistory {
  private entries: HistoryEntry[] = [];
  private index = -1;

  static from(snapshot: HistorySnapshot | undefined): NavigationHistory {
    const h = new NavigationHistory();
    if (snapshot && Array.isArray(snapshot.entries) && snapshot.entries.length > 0) {
      h.entries = snapshot.entries.slice(0, MAX_ENTRIES).map((e) => ({ ...e }));
      h.index = Math.min(Math.max(0, snapshot.index), h.entries.length - 1);
    }
    return h;
  }

  get current(): HistoryEntry | undefined {
    return this.entries[this.index];
  }

  get canBack(): boolean {
    return this.index > 0;
  }

  get canForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** Record where the reader is in the current entry (called as they scroll). */
  updatePosition(line: number, offset: number): void {
    const cur = this.current;
    if (cur) {
      cur.line = line;
      cur.offset = offset;
    }
  }

  /** Open a new location; drops any forward entries, like a browser. */
  push(uri: string, fragment?: string): HistoryEntry {
    const entry: HistoryEntry = { uri, line: 0, offset: 0, fragment };
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.index = this.entries.length - 1;
    return entry;
  }

  /** Swap the current location without adding history (e.g. the followed editor changed). */
  replace(uri: string, fragment?: string): HistoryEntry {
    if (this.index < 0) return this.push(uri, fragment);
    const entry: HistoryEntry = { uri, line: 0, offset: 0, fragment };
    this.entries[this.index] = entry;
    return entry;
  }

  back(): HistoryEntry | undefined {
    if (!this.canBack) return undefined;
    this.index -= 1;
    return this.current;
  }

  forward(): HistoryEntry | undefined {
    if (!this.canForward) return undefined;
    this.index += 1;
    return this.current;
  }

  snapshot(): HistorySnapshot {
    return { entries: this.entries.map((e) => ({ ...e })), index: this.index };
  }
}
