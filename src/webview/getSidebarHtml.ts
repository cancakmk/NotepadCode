import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Icons } from './icons';

/**
 * Generates the HTML for the Sidebar Explorer Webview.
 * Provides the notebook and page navigation tree with drag-and-drop reordering,
 * rename capabilities, minimalist buttons, and rich tooltips.
 */
export function getSidebarHtml(
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notepad Code Explorer</title>
  <style>
    ${cssContent}
  </style>
</head>
<body>
  <div id="sidebar-container">
    <header class="sidebar-header">
      <!-- Quick Search Box -->
      <div class="search-wrapper">
        <span class="search-icon-pos">${Icons.search}</span>
        <input type="text" id="search-input" class="search-input" placeholder="Search notes..." spellcheck="false" autocomplete="off" />
        <button id="search-clear" class="search-clear-btn" title="Clear Search">${Icons.close}</button>
      </div>
    </header>

    <!-- Explorer Navigation Content -->
    <main id="explorer-content" class="explorer-content"></main>

    <!-- Minimalist Modal Dialog -->
    <div id="modal-overlay" class="modal-overlay">
      <div class="modal-card">
        <div id="modal-title" class="modal-card-title">Notebook</div>
        <input type="text" id="modal-input" class="modal-card-input" placeholder="Enter name..." />
        <div class="modal-card-actions">
          <button id="modal-cancel-btn" class="btn-minimal" title="Cancel" style="flex: 0 0 auto; padding: 4px 12px;">Cancel</button>
          <button id="modal-submit-btn" class="btn-minimal" title="Save" style="flex: 0 0 auto; padding: 4px 14px; font-weight: 600;">Save</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      const icons = {
        chevronDown: \`${Icons.chevronDown}\`,
        chevronRight: \`${Icons.chevronRight}\`,
        book: \`${Icons.book}\`,
        fileText: \`${Icons.fileText}\`,
        plus: \`${Icons.plus}\`,
        edit: \`${Icons.edit}\`,
        grip: \`${Icons.grip}\`,
        trash: \`${Icons.trash}\`
      };

      const state = {
        data: { notebooks: [] },
        activeNotebookId: null,
        activePageId: null,
        searchQuery: '',
        collapsedNotebooks: new Set(),
        draggedType: null, // 'page' | 'notebook'
        draggedNotebookId: null,
        draggedPageId: null
      };

      let currentModalAction = null;

      const elements = {
        explorerContent: document.getElementById('explorer-content'),
        searchInput: document.getElementById('search-input'),
        searchClear: document.getElementById('search-clear'),
        btnNewNotebook: document.getElementById('btn-new-notebook'),
        btnExport: document.getElementById('btn-export'),
        btnImport: document.getElementById('btn-import'),
        modalOverlay: document.getElementById('modal-overlay'),
        modalTitle: document.getElementById('modal-title'),
        modalInput: document.getElementById('modal-input'),
        modalSubmitBtn: document.getElementById('modal-submit-btn'),
        modalCancelBtn: document.getElementById('modal-cancel-btn'),
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
            renderExplorer();
          } else if (msg.type === 'pageSelected') {
            state.activeNotebookId = msg.notebookId;
            state.activePageId = msg.pageId;
            renderExplorer();
          }
        });

        elements.searchInput.addEventListener('input', (e) => {
          state.searchQuery = e.target.value.trim().toLowerCase();
          elements.searchClear.style.display = state.searchQuery ? 'block' : 'none';
          renderExplorer();
        });

        elements.searchClear.addEventListener('click', () => {
          elements.searchInput.value = '';
          state.searchQuery = '';
          elements.searchClear.style.display = 'none';
          renderExplorer();
          elements.searchInput.focus();
        });

        if (elements.btnNewNotebook) {
          elements.btnNewNotebook.addEventListener('click', () => {
            showModal('Create New Notebook', 'Notebook name...', '', (name) => {
              vscode.postMessage({ type: 'createNotebook', title: name });
            });
          });
        }

        if (elements.btnExport) {
          elements.btnExport.addEventListener('click', () => {
            vscode.postMessage({ type: 'exportData' });
          });
        }

        if (elements.btnImport) {
          elements.btnImport.addEventListener('click', () => {
            vscode.postMessage({ type: 'importData' });
          });
        }

        elements.modalCancelBtn.addEventListener('click', hideModal);
        elements.modalSubmitBtn.addEventListener('click', submitModal);
        elements.modalInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitModal();
          if (e.key === 'Escape') hideModal();
        });
      }

      function renderExplorer() {
        elements.explorerContent.innerHTML = '';
        const notebooks = state.data.notebooks || [];

        if (notebooks.length === 0) {
          elements.explorerContent.innerHTML = \`
            <div class="empty-placeholder">
              <div style="opacity: 0.35;">\${icons.book}</div>
              <div class="empty-placeholder-title">No Notebooks Yet</div>
              <div class="empty-placeholder-desc">Click the notebook icon above to create your first notebook.</div>
            </div>
          \`;
          return;
        }

        const query = state.searchQuery;

        notebooks.forEach((nb, nbIndex) => {
          let pages = nb.pages || [];

          if (query) {
            pages = pages.filter(
              (p) => p.title.toLowerCase().includes(query) || (p.content && p.content.toLowerCase().includes(query))
            );
            if (pages.length === 0 && !nb.title.toLowerCase().includes(query)) {
              return;
            }
          }

          const isCollapsed = state.collapsedNotebooks.has(nb.id) && !query;
          const isActiveNb = state.activeNotebookId === nb.id;

          const groupEl = document.createElement('div');
          groupEl.className = \`notebook-group \${isCollapsed ? 'collapsed' : ''} \${isActiveNb ? 'active' : ''}\`;
          groupEl.dataset.notebookId = nb.id;

          // Header Row
          const headerEl = document.createElement('div');
          headerEl.className = 'notebook-header-row';
          headerEl.draggable = !query; // Only allow drag when not filtering
          headerEl.innerHTML = \`
            <div class="notebook-header-left">
              <span class="grip-handle" title="Drag to reorder notebook">\${icons.grip}</span>
              <span class="chevron-icon">\${icons.chevronDown}</span>
              <span class="notebook-icon">\${icons.book}</span>
              <span class="notebook-name" title="\${escapeHtml(nb.title)}">\${escapeHtml(nb.title)}</span>
              <span class="notebook-badge-count" title="\${pages.length} \${pages.length === 1 ? 'page' : 'pages'}">\${pages.length}</span>
            </div>
            <div class="notebook-hover-actions">
              <button class="btn-icon btn-rename-nb" title="Rename Notebook">\${icons.edit}</button>
              <button class="btn-icon btn-add-page" title="Add Page to Notebook">\${icons.plus}</button>
              <button class="btn-icon btn-del-nb" title="Delete Notebook">\${icons.trash}</button>
            </div>
          \`;

          // Notebook Drag & Drop
          headerEl.addEventListener('dragstart', (e) => {
            state.draggedType = 'notebook';
            state.draggedNotebookId = nb.id;
            groupEl.classList.add('dragging');
            e.dataTransfer.setData('text/plain', nb.id);
            e.dataTransfer.effectAllowed = 'move';
          });

          headerEl.addEventListener('dragend', () => {
            state.draggedType = null;
            state.draggedNotebookId = null;
            groupEl.classList.remove('dragging');
            document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((el) => {
              el.classList.remove('drag-over-top', 'drag-over-bottom');
            });
          });

          headerEl.addEventListener('dragover', (e) => {
            if (state.draggedType !== 'notebook' || state.draggedNotebookId === nb.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = headerEl.getBoundingClientRect();
            const isTop = e.clientY < rect.top + rect.height / 2;
            headerEl.classList.toggle('drag-over-top', isTop);
            headerEl.classList.toggle('drag-over-bottom', !isTop);
          });

          headerEl.addEventListener('dragleave', () => {
            headerEl.classList.remove('drag-over-top', 'drag-over-bottom');
          });

          headerEl.addEventListener('drop', (e) => {
            if (state.draggedType !== 'notebook' || state.draggedNotebookId === nb.id) return;
            e.preventDefault();
            const rect = headerEl.getBoundingClientRect();
            const isTop = e.clientY < rect.top + rect.height / 2;
            headerEl.classList.remove('drag-over-top', 'drag-over-bottom');

            // Reorder notebooks
            const fromId = state.draggedNotebookId;
            const fromIdx = state.data.notebooks.findIndex((n) => n.id === fromId);
            let toIdx = state.data.notebooks.findIndex((n) => n.id === nb.id);
            if (fromIdx === -1 || toIdx === -1) return;

            const [moved] = state.data.notebooks.splice(fromIdx, 1);
            if (!isTop && fromIdx < toIdx) toIdx--;
            if (!isTop && fromIdx > toIdx) toIdx++;
            state.data.notebooks.splice(toIdx, 0, moved);

            renderExplorer();
            vscode.postMessage({
              type: 'reorderNotebooks',
              notebookIds: state.data.notebooks.map((n) => n.id)
            });
          });

          // Toggle collapse
          headerEl.querySelector('.notebook-header-left').addEventListener('click', (e) => {
            if (e.target.closest('.grip-handle')) return;
            if (state.collapsedNotebooks.has(nb.id)) {
              state.collapsedNotebooks.delete(nb.id);
            } else {
              state.collapsedNotebooks.add(nb.id);
            }
            state.activeNotebookId = nb.id;
            renderExplorer();
          });

          // Rename notebook
          headerEl.querySelector('.btn-rename-nb').addEventListener('click', (e) => {
            e.stopPropagation();
            showModal('Rename Notebook', 'New notebook name...', nb.title, (newTitle) => {
              vscode.postMessage({
                type: 'updateNotebook',
                id: nb.id,
                title: newTitle
              });
            });
          });

          // Add page to this notebook
          headerEl.querySelector('.btn-add-page').addEventListener('click', (e) => {
            e.stopPropagation();
            state.activeNotebookId = nb.id;
            showModal(\`New Page in "\${nb.title}"\`, 'Page title...', '', (title) => {
              vscode.postMessage({ type: 'createPage', notebookId: nb.id, title });
            });
          });

          // Delete notebook
          headerEl.querySelector('.btn-del-nb').addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteNotebook', id: nb.id });
          });

          groupEl.appendChild(headerEl);

          // Pages list
          const pagesListEl = document.createElement('div');
          pagesListEl.className = 'pages-list';

          if (pages.length === 0) {
            pagesListEl.innerHTML = \`<div style="padding: 4px 8px; font-size: 11px; color: var(--text-muted); font-style: italic;">No pages</div>\`;
          } else {
            pages.forEach((page, pageIndex) => {
              const isSelected = state.activePageId === page.id;
              const pageEl = document.createElement('div');
              pageEl.className = \`page-row \${isSelected ? 'selected' : ''}\`;
              pageEl.draggable = !query; // Allow dragging when not in search
              pageEl.dataset.pageId = page.id;
              pageEl.dataset.notebookId = nb.id;
              pageEl.title = 'Click to open, drag to reorder';

              pageEl.innerHTML = \`
                <div class="page-row-left">
                  <span class="grip-handle" title="Drag to reorder">\${icons.grip}</span>
                  <span class="page-icon">\${icons.fileText}</span>
                  <span class="page-title">\${escapeHtml(page.title || 'Untitled')}</span>
                </div>
                <div class="page-time">\${formatTime(page.updatedAt)}</div>
                <div class="page-hover-actions">
                  <button class="btn-icon btn-del-page" title="Delete Page">\${icons.trash}</button>
                </div>
              \`;

              // Page Drag & Drop
              pageEl.addEventListener('dragstart', (e) => {
                state.draggedType = 'page';
                state.draggedPageId = page.id;
                state.draggedNotebookId = nb.id;
                pageEl.classList.add('dragging');
                e.dataTransfer.setData('text/plain', page.id);
                e.dataTransfer.effectAllowed = 'move';
              });

              pageEl.addEventListener('dragend', () => {
                state.draggedType = null;
                state.draggedPageId = null;
                state.draggedNotebookId = null;
                pageEl.classList.remove('dragging');
                document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((el) => {
                  el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
              });

              pageEl.addEventListener('dragover', (e) => {
                if (state.draggedType !== 'page' || state.draggedPageId === page.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = pageEl.getBoundingClientRect();
                const isTop = e.clientY < rect.top + rect.height / 2;
                pageEl.classList.toggle('drag-over-top', isTop);
                pageEl.classList.toggle('drag-over-bottom', !isTop);
              });

              pageEl.addEventListener('dragleave', () => {
                pageEl.classList.remove('drag-over-top', 'drag-over-bottom');
              });

              pageEl.addEventListener('drop', (e) => {
                if (state.draggedType !== 'page' || state.draggedPageId === page.id) return;
                e.preventDefault();
                const rect = pageEl.getBoundingClientRect();
                const isTop = e.clientY < rect.top + rect.height / 2;
                pageEl.classList.remove('drag-over-top', 'drag-over-bottom');

                // Same notebook reordering
                if (state.draggedNotebookId === nb.id) {
                  const fromIdx = nb.pages.findIndex((p) => p.id === state.draggedPageId);
                  let toIdx = nb.pages.findIndex((p) => p.id === page.id);
                  if (fromIdx === -1 || toIdx === -1) return;

                  const [moved] = nb.pages.splice(fromIdx, 1);
                  if (!isTop && fromIdx < toIdx) toIdx--;
                  if (!isTop && fromIdx > toIdx) toIdx++;
                  nb.pages.splice(toIdx, 0, moved);

                  renderExplorer();
                  vscode.postMessage({
                    type: 'reorderPages',
                    notebookId: nb.id,
                    pageIds: nb.pages.map((p) => p.id)
                  });
                }
              });

              // Click to open in editor tab
              pageEl.addEventListener('click', (e) => {
                if (e.target.closest('.btn-del-page') || e.target.closest('.grip-handle')) return;
                state.activeNotebookId = nb.id;
                state.activePageId = page.id;
                renderExplorer();
                vscode.postMessage({
                  type: 'openInEditor',
                  notebookId: nb.id,
                  pageId: page.id
                });
              });

              // Delete page
              pageEl.querySelector('.btn-del-page').addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({
                  type: 'deletePage',
                  notebookId: nb.id,
                  pageId: page.id
                });
              });

              pagesListEl.appendChild(pageEl);
            });
          }

          groupEl.appendChild(pagesListEl);
          elements.explorerContent.appendChild(groupEl);
        });
      }

      function showModal(title, placeholder, defaultValue, onConfirm) {
        elements.modalTitle.innerText = title;
        elements.modalInput.placeholder = placeholder;
        elements.modalInput.value = defaultValue || '';
        currentModalAction = onConfirm;
        elements.modalOverlay.classList.add('open');
        setTimeout(() => {
          elements.modalInput.focus();
          elements.modalInput.select();
        }, 50);
      }

      function hideModal() {
        elements.modalOverlay.classList.remove('open');
        elements.modalInput.value = '';
        currentModalAction = null;
      }

      function submitModal() {
        const val = elements.modalInput.value.trim();
        if (val && currentModalAction) {
          currentModalAction(val);
        }
        hideModal();
      }

      function escapeHtml(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function formatTime(ts) {
        if (!ts) return '';
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return 'now';
        if (diff < 3600) return \`\${Math.floor(diff / 60)}m\`;
        if (diff < 86400) return \`\${Math.floor(diff / 3600)}h\`;
        const d = new Date(ts);
        return \`\${d.getDate()}.\${d.getMonth() + 1}\`;
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
