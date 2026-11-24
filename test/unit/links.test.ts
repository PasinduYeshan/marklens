import { describe, expect, it } from 'vitest';
import { classifyLink } from '../../src/shared/links';

const doc = 'file:///repo/docs/design/architecture.md';
const root = 'file:///repo/';

describe('classifyLink', () => {
  it('keeps same-document anchors in the document', () => {
    expect(classifyLink('#data-flow', doc, root)).toEqual({ kind: 'fragment', fragment: 'data-flow' });
    expect(classifyLink('#caf%C3%A9', doc, root)).toEqual({ kind: 'fragment', fragment: 'café' });
  });

  it('resolves relative Markdown links with anchors', () => {
    expect(classifyLink('../api/README.md#errors', doc, root)).toEqual({
      kind: 'markdown',
      uri: 'file:///repo/docs/api/README.md',
      fragment: 'errors',
    });
    expect(classifyLink('notes%20v2.markdown', doc, root)).toMatchObject({ kind: 'markdown', uri: 'file:///repo/docs/design/notes%20v2.markdown' });
  });

  it('resolves root-relative links against the workspace folder', () => {
    expect(classifyLink('/README.md', doc, root)).toEqual({ kind: 'markdown', uri: 'file:///repo/README.md', fragment: undefined });
  });

  it('turns GitHub line anchors on source files into a line number', () => {
    expect(classifyLink('../../src/main.ts#L42', doc, root)).toEqual({ kind: 'file', uri: 'file:///repo/src/main.ts', line: 42 });
    expect(classifyLink('../../src/main.ts#L42-L50', doc, root)).toMatchObject({ line: 42 });
  });

  it('treats folders and other files as files', () => {
    expect(classifyLink('../api/', doc, root)).toMatchObject({ kind: 'file', uri: 'file:///repo/docs/api/' });
    expect(classifyLink('diagram.png', doc, root)).toMatchObject({ kind: 'file' });
  });

  it('opens web and mail links externally', () => {
    expect(classifyLink('https://example.com/a?b=1#c', doc, root)).toEqual({ kind: 'external', url: 'https://example.com/a?b=1#c' });
    expect(classifyLink('mailto:team@example.com', doc, root)).toMatchObject({ kind: 'external' });
  });

  it('never follows command, script or editor links from a document', () => {
    for (const href of ['command:workbench.action.terminal.new', 'javascript:alert(1)', 'vscode://file/etc/hosts', 'data:text/html,hi']) {
      expect(classifyLink(href, doc, root).kind).toBe('ignored');
    }
  });

  it('ignores empty links', () => {
    expect(classifyLink('  ', doc, root).kind).toBe('ignored');
  });
});
