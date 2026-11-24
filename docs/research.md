# MarkLens research: MPE vs built-in preview, webview facts

Paths: `MPE/` = ~/.vscode/extensions/shd101wyy.markdown-preview-enhanced-0.8.41/. `VSC/` = /Applications/Visual Studio Code.app/Contents/Resources/app/ (local install: VS Code 1.147.0, Electron 43.8.9, Chrome 150). Repo paths are relative to github.com/microsoft/vscode `main`.

## A. Markdown Preview Enhanced 0.8.41

**1. Rendering, plugins, Mermaid, zoom**
- Markdown is parsed in the **extension host** by crossnote, using markdown-it by default with a `markdown-yo` WASM or pandoc option (`markdownParser`). The host posts the HTML to a React webview with `command:"updateHtml"` (MPE/out/native/extension.js, MPE/crossnote/webview/preview.js).
- The webview panel uses `enableFindWidget:true`, `retainContextWhenHidden:true` and `enableScripts`. A custom editor `markdown-preview-enhanced` is also registered with the same options (extension.js, `createWebviewPanel`/`registerCustomEditorProvider`).
- markdown-it features found in the bundle: footnotes, mark, abbr, deflist, sub, sup, emoji, admonition/callouts, CriticMarkup, wikilinks, task lists, HTML5 embed, KaTeX or MathJax, `[TOC]`, and `data-source-line` attributes for scroll sync (string grep of extension.js).
- **Mermaid is rendered in the webview**: `window.mermaid.render(id, code)` for each `div.mermaid`, cached by source text, with a timeout (preview.js). There is no per-diagram zoom or pan, and no svg-pan-zoom or panzoom code in preview.js.
- **Zoom applies to the whole preview only**: `document.body.style.zoom = level`, from 0.2 to 5 in 0.1 steps. It is driven by Ctrl/Cmd+wheel (a capture-phase `wheel` listener) and the right-click menu Zoom In/Out/Reset, and is saved through `setZoomLevel` (preview.js). `enableImageLightbox` (default true) opens a clicked *image* full-window. Whether Mermaid SVGs open in the lightbox is unverified.

**2. Links to local .md files**
- The webview sorts each link as tag, `#anchor` or "external". Anything else goes to the host's `_crossnote.clickTagA` (preview.js `wh1`; extension.js `async function Nt`).
- The host opens the **source text editor** (`showTextDocument`) in ViewColumn.One, or in the group where the file is already open, and reveals `#L..` or a heading fragment.
- **Only `previewMode: "Previews Only"`** opens the target's preview instead (`initPreview` in the active column). `.pdf` and `.docx` files open externally, and http(s) links go through `vscode.open`.
- Issue #482 asks for exactly this behavior: "When linking to another markdown file, open preview but not the file" (open).

**3. Sidebar TOC**
- The host builds the HTML from the heading list (`S$s` in extension.js). Unordered TOCs use nested `<details open class="md-toc-details">`, so **they collapse**. Ordered TOCs are plain `<ol>`.
- The TOC is on the **right** and **resizable**: you drag `.md-sidebar-toc-resize-handle` between 200px and 50% of the window, and the width is saved in `crossnote.sidebarTocWidth` (preview.js `L71`).
- **No scroll-spy**: there is no active-heading tracking in preview.js. Clicks use the in-page anchor handler.

**4. Settings that matter for reading** (MPE/package.json, all prefixed `markdown-preview-enhanced.`)
- `previewMode`: Single, Multiple or Previews Only.
- Sync: `scrollSync`, `clickPreviewToRevealSource`, `highlightEditorSelectionInPreview`.
- Updates: `liveUpdate`, `liveUpdateDebounceMs` (300), `automaticallyShowPreviewOfMarkdownBeingEdited`.
- Look: `previewTheme`, `previewColorScheme`, `codeBlockTheme`, `mermaidTheme` (default, dark or forest only).
- Rendering: `mathRenderingOption`, `breakOnSingleNewLine` (default **true**), `enableWikiLinkSyntax`, `frontMatterRenderingOption`.
- UI: `enablePreviewZenMode`, `enableImageLightbox`, `alwaysShowBacklinksInPreview`.
- Limits: `maxNoteFileSize` (5 MB index cap), `markdownFileExtensions`.

**Recurring public complaints** (github.com/shd101wyy/vscode-markdown-preview-enhanced/issues)
- No diagram zoom: #568 "Zoom support?" (+6), #2005 (zoom Mermaid/Graphviz), #2256 (Mermaid too big), #606 (zoom shortcut, +5), #2124. All open.
- Links: #482 (open preview, not source), #46 and #1665 (local and relative links), #410.
- TOC: #1430 (sidebar TOC fails on CJK headings), #1650 (TOC jump misaligned), #1627 and #1140 (sidebar missing in HTML export).
- Performance: #228 high CPU (20 comments), #1870 slow refresh on long math-heavy files, #2209 "mermaid is very very slow", #545, #400.
- Scroll sync: #1730, #681, #1899 (broken in zen mode).
- Find: #2170 "cmd+f search … not working in the preview".

## B. Built-in preview (extensions/markdown-language-features)

- **`openMarkdownLinks: inPreview`** (default; `inEditor` is the other value): `#onDidClickPreviewLink` in src/preview/preview.ts resolves the href, and if the target is Markdown it calls `delegate.openPreviewLinkToMarkdownFile`.
  - A dynamic preview calls `this.update(link, StartingScrollFragment)`, which replaces the content in the same panel.
  - A static or custom-editor preview runs `vscode.openWith(uri#fragment, 'vscode.markdown.preview.editor', viewColumn)`.
  - Other links go to `opener.openDocumentLink` (src/util/openDocumentLink.ts, `markdown.links.openLocation`).
  - The webview sends `openLink` from a document click handler, and http, https, mailto and vscode links pass through (preview-src/index.ts).
- **Scroll sync**: `addLineNumberRenderer` in src/markdownEngine.ts sets `data-line=token.map[0]` and `class="code-line"` on block tokens.
  - preview-src/scroll-sync.ts builds a cached map of `.code-line` elements per document version (`getCodeLineMap`).
  - It binary-searches by pixel offset (`getLineElementsAtPageOffset`) and interpolates between the previous and next element (`getEditorLineNumberForPageOffset`), handling multi-line `<pre><code>` blocks by content height.
  - `scrollToRevealSourceLine` handles the editor-to-preview direction.
- **Locking**: `DynamicMarkdownPreview.#locked` (src/preview/preview.ts). `onDidChangeActiveTextEditor` retargets the preview only when it is not locked. Toggling the lock changes the title to "[Preview] …", and `matchesResource` keeps locked and unlocked previews separate. The manager is in src/preview/previewManager.ts.

## C. Webview API facts

1. **Fullscreen: not available to extensions.** Neither iframe grants it.
   - The outer iframe adds `fullscreen` to `allow` only when the internal `options.allowFullscreen` is set (src/vs/workbench/contrib/webview/browser/webviewElement.ts `_createElement`). On main it is used only by mediaPreview (mediaPlayerEditorInput.ts, added Nov 2026).
   - The inner iframe in shipped 1.147 has `allow="cross-origin-isolated; autoplay; clipboard-*"` and no fullscreen (VSC/out/vs/workbench/contrib/webview/browser/pre/index.html ~L1088).
   - `allowFullscreen` is not in vscode.d.ts.
   - Use a CSS "maximize inside panel" overlay instead.
2. **`enableFindWidget`** is on `WebviewPanelOptions` (vscode.d.ts ~L10056), which is used by `createWebviewPanel` and by custom editors through `webviewOptions`. It defaults to false.
   - In pre/index.html `handleInnerKeydown`, Ctrl/Cmd+F calls `preventDefault()` (`isFindEvent`) and is then **forwarded** as `did-keydown`. webviewElement.ts `handleKeyEvent` re-dispatches it to the workbench keybinding service.
   - The listener is a bubble-phase `keydown` on the content window, so **your page's own listeners do receive Cmd+F** (on document, or on window in the capture phase). Calling `stopPropagation()` there should stop the forward. This is inferred from the source and not runtime-tested.
3. **ES modules and `import()` work.** The service worker serves resources with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` (pre/service-worker.js). `.js` and `.mjs` are served as `application/javascript` (src/vs/platform/webview/common/mimeTypes.ts).
   - With `script-src ${cspSource} 'nonce-X'`, the entry `<script type="module" nonce src>` is allowed. Dynamic `import()` of chunks is allowed by the **host source** (`cspSource`), not the nonce.
   - Chunks must sit inside `localResourceRoots` and use relative paths (for example Vite `base:'./'`).
4. **Canvas taint**: Chromium taints a canvas for SVG with `<foreignObject>` loaded by URL. It does not taint `data:` URLs, and since a later intent it does not taint `blob:` URLs either ([blink-dev intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/JpA2vmA9XT8), [chromestatus](https://chromestatus.com/release-notes/170)).
   - Common fixes: serialize the SVG to a `data:` URL, or render Mermaid with `htmlLabels:false` (or `flowchart.htmlLabels:false`) so no foreignObject is produced.
   - Taint behavior in Chrome 150 inside a webview is not runtime-verified.
5. **Context keys**: `activeWebviewPanelId` (the panel's viewType) and `activeCustomEditorId` are defined in VSC/out/vs/workbench/workbench.desktop.main.js.
   - Others: `webviewFindWidgetEnabled`, `webviewFindWidgetVisible`, `webviewFindWidgetFocused`, `focusedCustomEditorIsEditable`.
   - Built-in usage: `"activeWebviewPanelId == 'markdown.preview' || activeCustomEditorId == 'vscode.markdown.preview.editor'"` (VSC/extensions/markdown-language-features/package.json).
6. **CSS Custom Highlight API**: shipped in Chrome 105 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)). The current Electron (Chrome 150), and every 1.10x build (Chromium 13x), is well past that, so it should work. Not runtime-tested.
