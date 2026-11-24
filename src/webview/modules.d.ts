declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

declare module 'markdown-it-front-matter' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (md: MarkdownIt, cb: (raw: string) => void) => void;
  export default plugin;
}

declare module '@vscode/markdown-it-katex' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (md: MarkdownIt, options?: Record<string, unknown>) => void;
  export default plugin;
}
