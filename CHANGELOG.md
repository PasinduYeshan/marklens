# Changelog

## 0.2.0

First public release.

- **Reader and side preview.** Open Markdown files in the MarkLens Reader without a source editor, or preview beside the editor. The side preview follows the active editor; pin it to keep a document.
- **Navigation.** Links to other Markdown files open in MarkLens with Back/Forward and scroll restore; anchors, relative paths, folder READMEs and `file#L42` source links work. ⌘/Ctrl+click opens a link in a new pinned preview.
- **Mermaid diagrams.** Each diagram has its own zoom and pan, a full-panel view, fit and 1:1, SVG/PNG export and copy as image. Colours follow the reader theme.
- **Table of contents.** Collapsible, resizable, follows the section you're reading, becomes a drawer in narrow panels.
- **Find** with highlighted matches and per-section counts.
- **Edit ⇄ Read** in the same tab with ⌘E / Ctrl+E, using VS Code's Markdown Editor or the text editor (`marklens.edit.editor`).
- **Themes**: Auto (follows VS Code), Light, Paper and Dark; text size and line width in the *Aa* pop-over.
- GitHub Flavored Markdown, KaTeX math, footnotes, task lists, GitHub alerts and Obsidian-style callouts, front matter, syntax highlighting with copy buttons, live updates (including unsaved edits) and optional scroll sync.
