# MarkLens

**A better way to read, explore, and navigate Markdown.**

MarkLens is a Markdown reader for VS Code, built for long technical documents: architecture designs, security reports, investigations and API references. It keeps you in the document. Diagrams zoom on their own, links to other files open in the reader, and a table of contents shows where you are.

## Highlights

- **Diagrams you can explore.** Every Mermaid diagram has its own zoom and pan, a full-panel view, fit and 1:1, and export to SVG or PNG. The page itself never zooms.
- **Browse docs like a website.** Links to other Markdown files open in the reader, not in an editor. Back and Forward work like a browser and return you to where you were. Anchors, `../relative` paths, folder links (`docs/` opens `docs/README.md`) and `file.ts#L42` source links all work.
- **Contents that follow you.** A right-hand table of contents highlights the section you're reading. You can collapse it, resize it and hide it. In narrow panels it becomes a drawer.
- **Read and edit in one tab.** Press `⌘E` / `Ctrl+E` (or the pencil) to edit the document in the same tab, in VS Code's built-in Markdown Editor (formatted editing) or, if you prefer, the text editor at the line you were reading. Press `⌘E` again (or the book icon) to switch back.
- **A standalone reader.** Open any Markdown file in MarkLens without its source editor: right-click › *Open in MarkLens Reader*, or *Open With…*. Pin a preview so it stays on one document.
- **Find with context.** ⌘F / Ctrl+F highlights every match, including text inside diagrams. The table of contents shows how many matches each section has.
- **Comfortable reading.** Measured line length, VS Code theme colors (light, dark and high contrast), syntax-highlighted code with copy buttons, and wide tables that scroll sideways. Text size and line width are one click away.
- **Rich Markdown.** GitHub Flavored Markdown, Mermaid, KaTeX math, task lists, footnotes, GitHub alerts and Obsidian-style callouts (`> [!tip] Title`), front matter, and images (click to zoom).
- **Live and fast.** Unsaved edits show up as you type. Only changed blocks re-render, so diagrams keep their zoom. Scroll sync with the editor is optional, and a 100 KB document with 480 sections loads in about 100 ms.

## Getting started

| To | Do this |
| --- | --- |
| Preview the file you're editing | Click the preview icon in the editor title, or press `⌘K ⌥V` / `Ctrl+K Alt+V` |
| Read a file without opening it | Right-click it in the Explorer › **Open in MarkLens Reader** |
| Keep a preview on one document | Click the pin in the preview's title bar |
| Open a link in a new pinned preview | `⌘`/`Ctrl`+click it, or middle-click |
| Edit what you're reading | `⌘E` / `Ctrl+E`, or the pencil. The reader becomes VS Code's Markdown Editor (or the text editor) in the same tab; `⌘E` or the book icon switches back |
| Read a file you're editing | Click the book icon in the editor title |
| Jump to the source from a side preview | Click **Open Source** in the title bar |

## Keyboard

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Edit ⇄ read (same tab) | `⌘E` | `Ctrl+E` |
| Find in document | `⌘F` | `Ctrl+F` |
| Back / Forward | `⌘[` / `⌘]`, mouse back/forward | `Alt+←` / `Alt+→`, mouse back/forward |
| Toggle table of contents | `⌘⇧O` | `Ctrl+Shift+O` |
| Diagram: zoom / fit / actual size | `+` `−` / `0` / `1` (diagram focused), `⌘`+scroll or pinch | `+` `−` / `0` / `1`, `Ctrl`+scroll |
| Diagram: pan | Drag, or arrow keys | Drag, or arrow keys |
| Diagram: full panel | `F` | `F` |
| Close find, menus, full panel | `Esc` | `Esc` |

A plain scroll wheel always scrolls the page, so diagrams never trap the reader. In the full-panel view the wheel pans the diagram.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `marklens.theme` | `auto` | `auto` follows VS Code; `light`, `paper` or `dark` force a reading theme (also under *Aa* in the toolbar) |
| `marklens.edit.editor` | `markdownEditor` | What Edit opens: VS Code's Markdown Editor, or `textEditor` |
| `marklens.typography.fontFamily` | system UI font | Body text font |
| `marklens.typography.codeFontFamily` | `editor.fontFamily` | Code font |
| `marklens.typography.fontSize` | `15` | Body text size (px) |
| `marklens.typography.lineHeight` | `1.65` | Line height |
| `marklens.layout.contentWidth` | `medium` | `narrow`, `medium`, `wide` or `full` |
| `marklens.layout.spacing` | `comfortable` | `compact`, `comfortable` or `relaxed` |
| `marklens.toc.visible` | `true` | Show the table of contents |
| `marklens.toc.depth` | `4` | Deepest heading level listed |
| `marklens.preview.scrollSync` | `true` | Scroll the preview and a visible editor together |
| `marklens.preview.followActiveEditor` | `true` | An unpinned preview follows the active Markdown editor |
| `marklens.mermaid.theme` | `auto` | Follows the VS Code theme, or `default`, `neutral`, `dark`, `forest` |
| `marklens.markdown.breaks` | `false` | Treat single line breaks as `<br>` |

To make MarkLens the default for Markdown files, run **View: Reopen Editor With…** on a Markdown file, choose **MarkLens Reader**, then choose *Configure default editor for '*.md'*.

## Privacy and security

- Rendering happens locally in the webview. MarkLens makes no network requests of its own; remote images in your documents load as they would in VS Code's built-in preview.
- Raw HTML is sanitized (no scripts, event handlers, forms or frames) and a strict Content Security Policy is applied. Mermaid runs with `securityLevel: 'strict'`.
- Documents can't run commands: `command:`, `vscode:` and `javascript:` links are never followed. External links go through VS Code's link opener, which asks before opening untrusted domains.
- MarkLens works in untrusted and virtual workspaces.

## Development

```bash
npm install
npm run build          # bundle the extension and webview
npm test               # unit tests (vitest)
npm run test:vscode    # integration tests in a real VS Code (isolated profile)
npm run dev            # browser harness at http://localhost:5178 with the test documents
npm run package        # production build + .vsix
```

Press `F5` in VS Code with this folder open to start an Extension Development Host. Architecture notes and the roadmap are in `docs/PLAN.md`.

## License

MIT
