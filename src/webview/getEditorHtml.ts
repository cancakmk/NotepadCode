import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Icons } from './icons';

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

  let cssContent = '';
  try {
    const cssPath = path.join(extensionUri.fsPath, 'src', 'webview', 'styles', 'monochrome.css');
    if (fs.existsSync(cssPath)) {
      cssContent = fs.readFileSync(cssPath, 'utf8');
    }
  } catch (err) {
    console.error('Failed to read monochrome.css:', err);
  }

  return /* html */ `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Düzenleyici</title>
  <style>
    ${cssContent}
  </style>
</head>
<body>
  <div id="editor-container">
    <!-- Top Minimalist Bar (Clean, no left branding, right-aligned actions) -->
    <header class="editor-header-bar">
      <div style="flex: 1;"></div>
      <div class="editor-header-actions">
        <div class="save-badge" title="Değişiklikler anında otomatik kaydedilir">
          <div id="save-circle" class="save-circle saved"></div>
          <span id="save-text">Kaydedildi</span>
        </div>
        <button id="btn-copy" class="btn-icon" title="Tüm Notu Panoya Kopyala">${Icons.copy}</button>
        <button id="btn-delete" class="btn-icon" title="Bu Notu Sil">${Icons.trash}</button>
      </div>
    </header>

    <!-- Main Note Canvas -->
    <main class="note-canvas">
      <input type="text" id="note-title" class="note-title-input" placeholder="Başlıksız Not" title="Sayfa Başlığı" spellcheck="false" autocomplete="off" />
      <textarea id="note-body" class="note-body-textarea" placeholder="Buraya doğrudan notlarınızı yazın..." title="Not İçeriği" spellcheck="false"></textarea>
    </main>

    <!-- Footer Stats -->
    <footer class="note-footer-bar">
      <span id="note-stats" title="Kelime ve Karakter Sayısı">0 kelime · 0 karakter</span>
    </footer>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      const icons = {
        copy: \`${Icons.copy}\`,
        check: \`${Icons.check}\`,
        trash: \`${Icons.trash}\`
      };

      const state = {
        data: { notebooks: [] },
        activeNotebookId: null,
        activePageId: null,
        saveTimeout: null,
      };

      const elements = {
        noteTitle: document.getElementById('note-title'),
        noteBody: document.getElementById('note-body'),
        noteStats: document.getElementById('note-stats'),
        saveCircle: document.getElementById('save-circle'),
        saveText: document.getElementById('save-text'),
        btnCopy: document.getElementById('btn-copy'),
        btnDelete: document.getElementById('btn-delete'),
      };

      function init() {
        setupEventListeners();
        vscode.postMessage({ type: 'ready' });
      }

      function setupEventListeners() {
        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg.type === 'syncData') {
            state.data = msg.data;
            refreshEditor();
          } else if (msg.type === 'pageSelected') {
            state.activeNotebookId = msg.notebookId;
            state.activePageId = msg.pageId;
            loadPage(msg.notebookId, msg.pageId);
          }
        });

        elements.noteTitle.addEventListener('input', onContentChange);
        elements.noteBody.addEventListener('input', onContentChange);

        elements.btnCopy.addEventListener('click', () => {
          const title = elements.noteTitle.value;
          const body = elements.noteBody.value;
          const fullText = (title ? title + '\\n\\n' : '') + body;
          navigator.clipboard.writeText(fullText).then(() => {
            elements.btnCopy.innerHTML = icons.check;
            elements.btnCopy.title = 'Panoya Kopyalandı!';
            setTimeout(() => {
              elements.btnCopy.innerHTML = icons.copy;
              elements.btnCopy.title = 'Tüm Notu Panoya Kopyala';
            }, 1500);
          });
        });

        elements.btnDelete.addEventListener('click', () => {
          if (!state.activeNotebookId || !state.activePageId) return;
          vscode.postMessage({
            type: 'deletePage',
            notebookId: state.activeNotebookId,
            pageId: state.activePageId,
          });
        });
      }

      function loadPage(notebookId, pageId) {
        state.activeNotebookId = notebookId;
        state.activePageId = pageId;

        const page = getCurrentPage();
        if (page) {
          elements.noteTitle.value = page.title || '';
          elements.noteBody.value = page.content || '';
          updateStats();
        }
      }

      function refreshEditor() {
        const page = getCurrentPage();
        if (page) {
          if (document.activeElement !== elements.noteTitle && document.activeElement !== elements.noteBody) {
            elements.noteTitle.value = page.title || '';
            elements.noteBody.value = page.content || '';
          }
          updateStats();
        }
      }

      function getCurrentPage() {
        if (!state.activeNotebookId || !state.activePageId) return null;
        const nb = (state.data.notebooks || []).find((n) => n.id === state.activeNotebookId);
        if (!nb) return null;
        return (nb.pages || []).find((p) => p.id === state.activePageId);
      }

      function onContentChange() {
        elements.saveCircle.classList.remove('saved');
        elements.saveText.innerText = 'Kaydediliyor...';
        updateStats();

        if (state.saveTimeout) {
          clearTimeout(state.saveTimeout);
        }

        state.saveTimeout = setTimeout(() => {
          savePage();
        }, 350);
      }

      function savePage() {
        if (!state.activeNotebookId || !state.activePageId) return;

        const title = elements.noteTitle.value.trim() || 'Başlıksız Not';
        const content = elements.noteBody.value;

        vscode.postMessage({
          type: 'updatePage',
          notebookId: state.activeNotebookId,
          pageId: state.activePageId,
          title: title,
          content: content,
        });

        elements.saveCircle.classList.add('saved');
        elements.saveText.innerText = 'Kaydedildi';

        const page = getCurrentPage();
        if (page) {
          page.title = title;
          page.content = content;
          page.updatedAt = Date.now();
        }
      }

      function updateStats() {
        const text = elements.noteBody.value || '';
        const words = text.trim() ? text.trim().split(/\\s+/).filter(Boolean).length : 0;
        const chars = text.length;
        elements.noteStats.innerText = \`\${words} kelime · \${chars} karakter\`;
      }

      init();
    })();
  </script>
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
