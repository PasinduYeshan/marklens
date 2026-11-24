import { describe, expect, it } from 'vitest';
import { render } from '../../src/webview/render';

const md = (text: string, breaks = false) => render(text, { breaks });

describe('render', () => {
  it('adds GitHub-style heading ids and collects headings', () => {
    const r = md('# Title\n\n## Data flow\n\n## Data flow\n\n### `code` & more');
    expect(r.headings.map((h) => h.id)).toEqual(['title', 'data-flow', 'data-flow-1', 'code--more']);
    expect(r.headings.map((h) => h.level)).toEqual([1, 2, 2, 3]);
    expect(r.title).toBe('Title');
    expect(r.html).toContain('<h2 data-line="4" id="data-flow-1">');
  });

  it('marks blocks with their source line for scroll sync', () => {
    const r = md('para\n\n- a\n- b\n\n```js\nx\n```');
    expect(r.html).toContain('<p data-line="0">');
    expect(r.html).toContain('<ul data-line="2">');
    expect(r.html).toMatch(/<pre class="ml-code" data-line="5" data-lang="js">/);
  });

  it('renders GitHub alerts and custom callout titles', () => {
    const note = md('> [!NOTE]\n> Read this.');
    expect(note.html).toContain('ml-callout ml-callout-note');
    expect(note.html).toContain('Note</p>');
    expect(note.html).toContain('<p data-line="1">Read this.</p>');

    const tip = md('> [!tip] Faster *builds*\n> Use the cache.');
    expect(tip.html).toContain('ml-callout-tip');
    expect(tip.html).toContain('Faster <em>builds</em></p>');

    const alias = md('> [!danger]\n> Careful.');
    expect(alias.html).toContain('ml-callout-caution');
    expect(alias.html).toContain('Danger</p>');

    expect(md('> [!unknown]\n> x').html).not.toContain('ml-callout');
    expect(md('> plain quote').html).not.toContain('ml-callout');
  });

  it('renders task lists without form controls', () => {
    const r = md('- [x] done\n- [ ] todo\n- normal');
    expect(r.html).toContain('class="ml-task-list"');
    expect(r.html).toContain('ml-task ml-task-done');
    expect(r.html).toContain('aria-label="To do"');
    expect(r.html).not.toContain('<input');
  });

  it('keeps Mermaid source for the diagram renderer', () => {
    const r = md('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(r.html).toContain('<div class="ml-mermaid" data-line="0"><pre class="ml-mermaid-source">flowchart LR\n  A --&gt; B\n</pre></div>');
  });

  it('highlights known languages and escapes unknown ones', () => {
    expect(md('```ts\nconst a = 1;\n```').html).toContain('hljs-keyword');
    expect(md('```nope\n<b>\n```').html).toContain('&lt;b&gt;');
  });

  it('renders math, footnotes and front matter', () => {
    const r = md('---\ntitle: x\n---\n\n$a^2$ and text[^1]\n\n[^1]: note');
    expect(r.html).toContain('class="katex"');
    expect(r.html).toContain('footnote-ref');
    expect(r.html).toContain('ml-frontmatter');
  });

  it('respects the breaks option', () => {
    expect(md('a\nb', true).html).toContain('<br>');
    expect(md('a\nb', false).html).not.toContain('<br>');
  });
});
