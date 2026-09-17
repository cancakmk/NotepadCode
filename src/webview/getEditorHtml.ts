import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Icons } from './icons';
import { loadStyles } from './styles';

/**
 * Generates the HTML for the Editor Tab Webview.
 * Provides a clean, distraction-free note canvas with editorial typography,
 * direct note taking, minimalist buttons with rich tooltips, and no brand clutter.
 */
export function getEditorHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = getNonce();

  const cssContent = loadStyles(extensionUri);

  // The Tiptap rich text editor is bundled separately into dist/webview/editor.js
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'editor.js')
  );

  // KaTeX ships its own stylesheet and web fonts. Both are copied into
  // dist/webview by the build; font URLs are rewritten to webview URIs so
  // nothing is ever loaded from a CDN.
  let katexCss = '';
  try {
    const katexCandidates = [
      path.join(extensionUri.fsPath, 'dist', 'webview', 'katex.min.css'),
      path.join(extensionUri.fsPath, 'node_modules', 'katex', 'dist', 'katex.min.css'),
    ];
    const katexPath = katexCandidates.find((candidate) => fs.existsSync(candidate));

    if (katexPath) {
      const fontDir = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'fonts')
      );
      katexCss = fs
        .readFileSync(katexPath, 'utf8')
        .replace(/url\(fonts\/([^)]+)\)/g, `url(${fontDir}/$1)`);
    }
  } catch (err) {
    console.error('Failed to read katex.min.css:', err);
  }

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Note Editor</title>
  <style>
    ${cssContent}
    ${katexCss}
  </style>
</head>
<body>
  <div id="editor-container">
    <!-- Top Minimalist Bar (Clean, no left branding, right-aligned actions) -->
    <header class="editor-header-bar">
      <div style="flex: 1;"></div>
      <div class="editor-header-actions">
        <div class="save-badge" title="Changes saved automatically">
          <div id="save-circle" class="save-circle saved"></div>
          <span id="save-text">Saved</span>
        </div>
        <button id="btn-copy" class="btn-icon" title="Copy Full Note to Clipboard">${Icons.copy}</button>
        <button id="btn-delete" class="btn-icon" title="Delete Note">${Icons.trash}</button>
      </div>
    </header>

    <!-- Main Note Canvas -->
    <main class="note-canvas">
      <input type="text" id="note-title" class="note-title-input" placeholder="Untitled Note" title="Note Title" spellcheck="false" autocomplete="off" />
      <div id="note-body" class="np-editor-mount"></div>
    </main>

    <!-- Floating toolbar shown for a text selection -->
    <div id="bubble-menu" class="np-bubble-menu">
      <div class="bubble-row">
        <button data-action="bold" title="Bold (Cmd+B)" style="font-weight: 700;">B</button>
        <button data-action="italic" title="Italic (Cmd+I)" style="font-style: italic;">I</button>
        <button data-action="underline" title="Underline (Cmd+U)" style="text-decoration: underline;">U</button>
        <button data-action="strike" title="Strikethrough (Cmd+Shift+S)"><s>S</s></button>
        <button data-action="code" title="Inline code (Cmd+E)" style="font-family: var(--font-mono); font-size: 11px;">&lt;/&gt;</button>
        <button data-action="highlight" title="Highlight">
          <span style="border-bottom: 3px solid currentColor;">H</span>
        </button>
        <button data-action="superscript" title="Superscript">x<sup>2</sup></button>
        <button data-action="subscript" title="Subscript">x<sub>2</sub></button>
        <span class="bubble-sep"></span>
        <button data-action="link" title="Link">Link</button>
        <button data-action="link-remove" title="Remove link">Unlink</button>
        <button data-action="clear" title="Clear formatting">Clear</button>
      </div>
      <div class="bubble-row">
        <button data-align="left" title="Align left">&#8676;</button>
        <button data-align="center" title="Align center">&#8660;</button>
        <button data-align="right" title="Align right">&#8677;</button>
        <button data-align="justify" title="Justify">&#8801;</button>
        <span class="bubble-sep"></span>
        <button data-action="blockquote" title="Quote">&#10077;</button>
        <button data-action="codeblock" title="Code block">&lt;/&gt;</button>
        <button id="block-convert" title="Turn into...">Turn into</button>
      </div>
    </div>

    <!-- Floating toolbar for table editing -->
    <div id="table-menu" class="np-bubble-menu"></div>

    <!-- Notion-style quick add buttons that appear on the table edges -->
    <div class="np-table-handles">
      <button id="table-handle-column" class="np-table-handle" title="Add column">+</button>
      <button id="table-handle-row" class="np-table-handle" title="Add row">+</button>
    </div>

    <!-- Slash (/) block inserter -->
    <div id="slash-menu" class="np-slash-menu"></div>

    <!-- Floating language switcher shown while editing a code block -->
    <div id="code-menu" class="np-bubble-menu">
      <div class="bubble-row">
        <button id="code-lang-button" title="Choose the code block language">
          <span id="code-lang-label">Plain text</span> <span class="code-lang-caret">&#9662;</span>
        </button>
      </div>
    </div>

    <!-- Code language list -->
    <div id="code-lang-picker" class="np-popover"></div>

    <!-- Emoji picker -->
    <div id="emoji-picker" class="np-popover"></div>

    <!-- Text styling popover (font, size, colors) -->
    <div id="style-picker" class="np-popover"></div>

    <!-- Small input dialog (link URL, math, image, table size) -->
    <div id="input-dialog" class="np-dialog-overlay">
      <div class="np-dialog">
        <div id="input-dialog-title" class="np-dialog-title">Input</div>
        <input id="input-dialog-field" class="np-dialog-input" type="text" spellcheck="false" />
        <div class="np-dialog-hint" id="input-dialog-hint"></div>
        <div class="np-dialog-actions">
          <button id="input-dialog-cancel" class="btn-minimal">Cancel</button>
          <button id="input-dialog-submit" class="btn-minimal">Insert</button>
        </div>
      </div>
    </div>

    <!-- Footer Stats -->
    <footer class="note-footer-bar">
      <span id="note-stats" title="Word and Character Count">0 words · 0 characters</span>
      <div class="footer-view-toggles">
        <button id="btn-focus" class="btn-minimal" title="Focus mode — dim everything but the current block">Focus</button>
        <button id="btn-invisible" class="btn-minimal" title="Show invisible characters (spaces, breaks)">&#182;</button>
      </div>
    </footer>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
