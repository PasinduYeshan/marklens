// Markdown → HTML. Runs in the webview so the extension host stays idle and the
// renderer is the same in VS Code and in the browser dev harness.

import markdownit, { type MarkdownIt, type StateCore, type Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import frontMatter from 'markdown-it-front-matter';
import katexPlugin from '@vscode/markdown-it-katex';
import GithubSlugger from 'github-slugger';
import hljs from 'highlight.js/lib/common';

export interface Heading {
  level: number;
  text: string;
  id: string;
  line: number;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
  title?: string;
}

export interface RenderOptions {
  breaks: boolean;
}

interface Env {
  [key: string | symbol]: unknown;
  headings: Heading[];
  slugger: GithubSlugger;
  frontMatter?: string;
}

let cached: { key: string; md: MarkdownIt } | undefined;

export function render(text: string, options: RenderOptions): RenderResult {
  const key = JSON.stringify(options);
  if (!cached || cached.key !== key) cached = { key, md: createMarkdownIt(options) };
  const env: Env = { headings: [], slugger: new GithubSlugger() };
  const html = cached.md.render(text, env);
  const h1 = env.headings.find((h) => h.level === 1);
  return { html, headings: env.headings, title: h1?.text };
}

export function createMarkdownIt(options: RenderOptions): MarkdownIt {
  const md = markdownit({ html: true, linkify: true, typographer: false, breaks: options.breaks });
  md.use(frontMatter, () => {});
  md.use(footnote);
  md.use(katexPlugin, { enableFencedBlocks: true, enableBareBlocks: false, throwOnError: false } as never);

  md.core.ruler.push('ml_line_numbers', lineNumbers);
  md.core.ruler.push('ml_headings', headingIds);
  md.core.ruler.push('ml_task_lists', taskLists);
  md.core.ruler.push('ml_callouts', callouts);

  md.renderer.rules.front_matter = (tokens, idx) => {
    const raw = (tokens[idx] as Token & { meta: string }).meta ?? '';
    if (!raw.trim()) return '';
    return `<details class="ml-frontmatter" data-line="0"><summary>Properties</summary><pre><code class="hljs language-yaml">${highlight(raw, 'yaml')}</code></pre></details>\n`;
  };

  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const line = token.map ? ` data-line="${token.map[0]}"` : '';
    if (lang === 'mermaid') {
      return `<div class="ml-mermaid"${line}><pre class="ml-mermaid-source">${md.utils.escapeHtml(token.content)}</pre></div>\n`;
    }
    if (lang === 'math' || lang === 'latex' || lang === 'katex' || lang === 'tex') {
      return defaultFence(tokens, idx, opts, env, self); // handled by the KaTeX plugin
    }
    const label = lang ? ` data-lang="${md.utils.escapeHtml(lang)}"` : '';
    const cls = lang ? ` language-${md.utils.escapeHtml(lang)}` : '';
    return `<pre class="ml-code"${line}${label}><code class="hljs${cls}">${highlight(token.content, lang)}</code></pre>\n`;
  };
  md.renderer.rules.code_block = (tokens, idx) => {
    const token = tokens[idx];
    const line = token.map ? ` data-line="${token.map[0]}"` : '';
    return `<pre class="ml-code"${line}><code class="hljs">${md.utils.escapeHtml(token.content)}</code></pre>\n`;
  };
  return md;
}

// ---- Syntax highlighting (memoised: live updates re-render every block) ----

const highlightCache = new Map<string, string>();

export function highlight(code: string, lang: string): string {
  const key = `${lang}\u0000${code}`;
  const hit = highlightCache.get(key);
  if (hit !== undefined) return hit;
  let out: string;
  const language = lang && hljs.getLanguage(lang) ? lang : undefined;
  try {
    out = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code);
  } catch {
    out = escapeHtml(code);
  }
  if (highlightCache.size > 800) highlightCache.delete(highlightCache.keys().next().value!);
  highlightCache.set(key, out);
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---- Core rules ----

/** Adds data-line to block tokens so the preview and editor can scroll together. */
function lineNumbers(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.block && token.type !== 'inline') {
      token.attrSet('data-line', String(token.map[0]));
    }
  }
}

/** GitHub-compatible heading ids, collected for the table of contents. */
function headingIds(state: StateCore): void {
  const env = state.env as unknown as Env;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = inlineText(inline);
    const existing = t.attrGet('id');
    const id = existing !== null ? String(existing) : env.slugger.slug(text);
    t.attrSet('id', id);
    env.headings.push({ level: Number(t.tag.slice(1)), text, id, line: t.map?.[0] ?? 0 });
  }
}

function inlineText(inline: Token | undefined): string {
  if (!inline?.children) return inline?.content ?? '';
  return inline.children
    .map((c) => (c.type === 'text' || c.type === 'code_inline' || c.type === 'math_inline' ? c.content : c.type === 'softbreak' ? ' ' : ''))
    .join('')
    .trim();
}

/** "- [ ] item" / "- [x] item" → read-only checkboxes. */
function taskLists(state: StateCore): void {
  const tokens = state.tokens;
  const listStack: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') listStack.push(t);
    else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') listStack.pop();
    if (t.type !== 'inline' || tokens[i - 1]?.type !== 'paragraph_open' || tokens[i - 2]?.type !== 'list_item_open') continue;
    const first = t.children?.[0];
    const m = first?.type === 'text' ? /^\[([ xX])\](?:\s|$)/.exec(first.content) : null;
    if (!first || !m) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token('html_inline', '', 0);
    const done = m[1] !== ' ';
    box.content = `<span class="ml-task${done ? ' ml-task-done' : ''}" role="img" aria-label="${done ? 'Done' : 'To do'}"></span>`;
    t.children!.unshift(box);
    tokens[i - 2].attrJoin('class', 'ml-task-item');
    const list = listStack[listStack.length - 1];
    if (list && !(list.attrGet('class') ?? '').toString().includes('ml-task-list')) list.attrJoin('class', 'ml-task-list');
  }
}

const CALLOUT_KINDS: Record<string, string> = {
  note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note', todo: 'note', example: 'note', quote: 'note', cite: 'note',
  question: 'note', help: 'note', faq: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
  important: 'important',
  warning: 'warning', attention: 'warning',
  caution: 'caution', danger: 'caution', error: 'caution', bug: 'caution', failure: 'caution', fail: 'caution', missing: 'caution',
};

/** GitHub alerts ("> [!NOTE]") plus Obsidian-style types and custom titles ("> [!tip] Faster builds"). */
function callouts(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open') continue;
    const pOpen = tokens[i + 1];
    const inline = tokens[i + 2];
    if (pOpen?.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children?.length) continue;
    const first = inline.children[0];
    if (first.type !== 'text') continue;
    const m = /^\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)$/.exec(first.content);
    if (!m) continue;
    const typed = m[1].toLowerCase();
    const kind = CALLOUT_KINDS[typed];
    if (!kind) continue;

    // The title is the rest of the marker line (up to the first line break).
    const children = inline.children;
    let br = children.findIndex((c) => c.type === 'softbreak' || c.type === 'hardbreak');
    if (br === -1) br = children.length;
    const titleTokens = children.slice(1, br);
    const customTitle = m[3] || titleTokens.length > 0;
    first.content = m[3];
    const titleHtml = customTitle
      ? state.md.renderer.renderInline([first, ...titleTokens], state.md.options, state.env)
      : escapeHtml(typed === kind || typed.length < 3 ? capitalize(kind) : capitalize(typed));
    inline.children = children.slice(br + 1);
    inline.content = '';
    if (pOpen.map && inline.children.length) pOpen.attrSet('data-line', String(pOpen.map[0] + 1));

    tokens[i].attrJoin('class', `ml-callout ml-callout-${kind}`);
    const title = new state.Token('html_block', '', 0);
    title.content = `<p class="ml-callout-title"><span class="codicon codicon-${CALLOUT_ICONS[kind]}" aria-hidden="true"></span>${titleHtml}</p>\n`;
    tokens.splice(i + 1, 0, title);
    if (inline.children.length === 0) {
      // Marker-only first paragraph: drop it (paragraph_open, inline, paragraph_close).
      tokens.splice(i + 2, 3);
    }
  }
}

const CALLOUT_ICONS: Record<string, string> = { note: 'info', tip: 'lightbulb', important: 'report', warning: 'warning', caution: 'error' };

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
