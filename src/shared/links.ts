// Classifies a link written in a Markdown document. Pure (WHATWG URL only), shared
// by the extension host and the browser dev harness.

import { isMarkdownPath } from './protocol';

export type LinkTarget =
  | { kind: 'fragment'; fragment: string }
  | { kind: 'external'; url: string }
  | { kind: 'markdown'; uri: string; fragment?: string }
  /** A local non-Markdown file or a folder; `line` comes from GitHub-style "#L10" fragments. */
  | { kind: 'file'; uri: string; line?: number; fragment?: string }
  | { kind: 'ignored'; reason: string };

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function classifyLink(href: string, currentUri: string, rootUri?: string): LinkTarget {
  const raw = href.trim();
  if (!raw) return { kind: 'ignored', reason: 'empty link' };

  if (raw.startsWith('#')) {
    return { kind: 'fragment', fragment: safeDecode(raw.slice(1)) };
  }

  if (SCHEME_RE.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { kind: 'ignored', reason: 'malformed link' };
    }
    if (EXTERNAL_SCHEMES.has(url.protocol)) return { kind: 'external', url: url.toString() };
    if (url.protocol === 'file:') return local(url);
    // command:, javascript:, vscode: and friends are never followed from a document.
    return { kind: 'ignored', reason: `${url.protocol} links are not opened from documents` };
  }

  let base: URL;
  try {
    base = new URL(raw.startsWith('/') && rootUri ? withTrailingSlash(rootUri) : currentUri);
  } catch {
    return { kind: 'ignored', reason: 'the current document has no folder to resolve links against' };
  }
  let url: URL;
  try {
    url = new URL(raw.startsWith('/') && rootUri ? raw.slice(1) : raw, base);
  } catch {
    return { kind: 'ignored', reason: 'malformed link' };
  }
  return local(url);
}

function local(url: URL): LinkTarget {
  const fragment = url.hash ? safeDecode(url.hash.slice(1)) : undefined;
  url.hash = '';
  url.search = '';
  const uri = url.toString();
  if (isMarkdownPath(safeDecode(url.pathname))) return { kind: 'markdown', uri, fragment };
  const lineMatch = fragment?.match(/^L(\d+)(?:-L?\d+)?$/);
  if (lineMatch) return { kind: 'file', uri, line: Number(lineMatch[1]) };
  return { kind: 'file', uri, fragment };
}

function withTrailingSlash(s: string): string {
  return s.endsWith('/') ? s : `${s}/`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
