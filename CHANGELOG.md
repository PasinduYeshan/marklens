# Changelog

## 0.1.3

- Edit opens VS Code's built-in Markdown Editor (formatted editing) in the reader's tab; `⌘E` or the book icon returns to the reader. Set `marklens.edit.editor` to `textEditor` for the plain editor at the current line.

## 0.1.2

- Paper theme: a warm, paper-like page with dark ink.
- Mermaid diagrams take their colours from the reader theme: tinted nodes, accent borders and lines, notes in a soft amber.
- Forced Light, Paper and Dark themes no longer pick up VS Code's own quote and inline-code colours.

## 0.1.1

- Edit ⇄ Read: `⌘E` / `Ctrl+E` switches a reader tab to a text editor in place, at the same line, and back.
- Reading theme: Auto (follows VS Code), Light or Dark, in the *Aa* pop-over or `marklens.theme`.
- Diagrams stay visible while they re-render for a new theme.

## 0.1.0

First preview release.

- Side preview that follows the active Markdown editor, with pinning.
- MarkLens Reader: open Markdown files without a source editor.
- In-reader navigation between documents with Back/Forward and scroll restore.
- Mermaid diagrams with per-diagram zoom, pan, full-panel view and SVG/PNG export.
- Right-hand table of contents: collapsible, resizable, follows the reading position.
- Find in document with per-section match counts.
- GFM, KaTeX math, footnotes, task lists, callouts, front matter, syntax highlighting.
- Live updates (including unsaved edits) and optional scroll sync.
