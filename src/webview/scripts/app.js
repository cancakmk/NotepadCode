/**
 * Notepad Code - Client Script
 * Manages reactive state, auto-saving, markdown parsing, and extension messaging.
 */

// Acquire VS Code API safely
const vscode = (typeof acquireVsCodeApi === 'function')
  ? acquireVsCodeApi()
  : (window.__vscodeApi || { postMessage: () => {} });
window.__vscodeApi = vscode;

// Application State
const state = {
  data: { notebooks: [] },
  activeNotebookId: null,
  activePageId: null,
  activeTab: 'write', // 'write' | 'preview'
  searchQuery: '',
  collapsedNotebooks: new Set(),
  saveTimeout: null,
};

// DOM Element References (populated in init)
let elements = {};
let currentModalAction = null;

// =============================================================================
// Initialization & Event Listeners
// =============================================================================

function init() {
  elements = {
    navPanel: document.getElementById('nav-panel'),
    editorPanel: document.getElementById('editor-panel'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    btnNewNotebook: document.getElementById('btn-new-notebook'),
    btnNewPage: document.getElementById('btn-new-page'),
    btnExport: document.getElementById('btn-export'),
    btnImport: document.getElementById('btn-import'),
    // Editor elements
    editorBackBtn: document.getElementById('editor-back-btn'),
    editorTitleInput: document.getElementById('editor-title-input'),
    editorTextarea: document.getElementById('editor-textarea'),
    editorPreview: document.getElementById('editor-preview'),
    tabWrite: document.getElementById('tab-write'),
    tabPreview: document.getElementById('tab-preview'),
    btnPinPage: document.getElementById('btn-pin-page'),
    btnCopyPage: document.getElementById('btn-copy-page'),
    btnDeletePage: document.getElementById('btn-delete-page'),
    btnOpenInEditor: document.getElementById('btn-open-in-editor'),
    footerStats: document.getElementById('footer-stats'),
    saveStatus: document.getElementById('save-status'),
    saveDot: document.getElementById('save-dot'),
    // Modals
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalInput: document.getElementById('modal-input'),
    modalSubmitBtn: document.getElementById('modal-submit-btn'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),
  };

  setupEventListeners();
  // Notify extension that webview is ready to receive data
  vscode.postMessage({ type: 'ready' });
}

function setupEventListeners() {
  // Window message listener
  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'syncData':
        state.data = message.data;
        if (!state.activeNotebookId && state.data.notebooks.length > 0) {
          state.activeNotebookId = state.data.notebooks[0].id;
        }
        renderNav();
        if (state.activePageId) {
          refreshActivePage();
        }
        break;

      case 'pageSelected':
        state.activeNotebookId = message.notebookId;
        state.activePageId = message.pageId;
        openPage(message.notebookId, message.pageId);
        break;
    }
  });

  // Search input
  elements.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    elements.searchClear.style.display = state.searchQuery ? 'block' : 'none';
    renderNav();
  });

  elements.searchClear.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.searchQuery = '';
    elements.searchClear.style.display = 'none';
    renderNav();
    elements.searchInput.focus();
  });

  // Toolbar buttons
  elements.btnNewNotebook.addEventListener('click', () => {
    showModal('Create New Notebook', 'Notebook Name...', (name) => {
      vscode.postMessage({ type: 'createNotebook', title: name });
    });
  });

  elements.btnNewPage.addEventListener('click', () => {
    const targetNotebookId = state.activeNotebookId || (state.data.notebooks[0] && state.data.notebooks[0].id);
    if (!targetNotebookId) {
      showModal('Create Notebook First', 'Notebook Name...', (name) => {
        vscode.postMessage({ type: 'createNotebook', title: name });
      });
      return;
    }
    showModal('Create New Page', 'Page Title...', (title) => {
      vscode.postMessage({ type: 'createPage', notebookId: targetNotebookId, title });
    });
  });

  elements.btnExport.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportData' });
  });

  elements.btnImport.addEventListener('click', () => {
    vscode.postMessage({ type: 'importData' });
  });

  // Editor Actions
  elements.editorBackBtn.addEventListener('click', () => {
    closeEditor();
  });

  elements.tabWrite.addEventListener('click', () => {
    setEditorTab('write');
  });

  elements.tabPreview.addEventListener('click', () => {
    setEditorTab('preview');
  });

  elements.editorTitleInput.addEventListener('input', handleContentChange);
  elements.editorTextarea.addEventListener('input', handleContentChange);

  elements.btnPinPage.addEventListener('click', () => {
    if (state.activeNotebookId && state.activePageId) {
      vscode.postMessage({
        type: 'togglePinPage',
        notebookId: state.activeNotebookId,
        pageId: state.activePageId,
      });
    }
  });

  elements.btnCopyPage.addEventListener('click', () => {
    const content = elements.editorTextarea.value;
    navigator.clipboard.writeText(content).then(() => {
      elements.btnCopyPage.innerText = 'Copied!';
      setTimeout(() => {
        elements.btnCopyPage.innerHTML = '📋 Copy';
      }, 1500);
    });
  });

  elements.btnDeletePage.addEventListener('click', () => {
    if (!state.activeNotebookId || !state.activePageId) return;
    const page = getActivePage();
    if (!page) return;

    if (confirm(`Are you sure you want to delete page "${page.title}"?`)) {
      vscode.postMessage({
        type: 'deletePage',
        notebookId: state.activeNotebookId,
        pageId: state.activePageId,
      });
      closeEditor();
    }
  });

  elements.btnOpenInEditor.addEventListener('click', () => {
    if (state.activeNotebookId && state.activePageId) {
      vscode.postMessage({
        type: 'openInEditor',
        notebookId: state.activeNotebookId,
        pageId: state.activePageId,
      });
    }
  });

  // Modal events
  elements.modalCancelBtn.addEventListener('click', hideModal);
  elements.modalSubmitBtn.addEventListener('click', submitModal);
  elements.modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitModal();
    if (e.key === 'Escape') hideModal();
  });
}

// =============================================================================
// Rendering Navigation List (Notebooks & Pages)
// =============================================================================

function renderNav() {
  elements.navPanel.innerHTML = '';

  const notebooks = state.data.notebooks || [];
  if (notebooks.length === 0) {
    elements.navPanel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📓</div>
        <div class="empty-state-title">No Notebooks Found</div>
        <div class="empty-state-desc">Click the "+ Notebook" button above to create your first notebook.</div>
      </div>
    `;
    return;
  }

  const query = state.searchQuery;

  notebooks.forEach((nb) => {
    let pages = nb.pages || [];

    // Filter pages if search is active
    if (query) {
      pages = pages.filter(
        (p) => p.title.toLowerCase().includes(query) || (p.content && p.content.toLowerCase().includes(query))
      );
      if (pages.length === 0 && !nb.title.toLowerCase().includes(query)) {
        return; // Skip this notebook entirely if no matches
      }
    }

    const isCollapsed = state.collapsedNotebooks.has(nb.id) && !query;
    const isActiveNotebook = state.activeNotebookId === nb.id;

    const nbEl = document.createElement('div');
    nbEl.className = `notebook-item ${isCollapsed ? 'collapsed' : ''} ${isActiveNotebook ? 'active-notebook' : ''}`;

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'notebook-header';
    headerEl.innerHTML = `
      <div class="notebook-info">
        <span class="notebook-chevron">▼</span>
        <span class="notebook-title">${escapeHtml(nb.title)}</span>
        <span class="notebook-count">${pages.length}</span>
      </div>
      <div class="notebook-actions">
        <button class="action-icon-btn btn-add-page" title="Add Page to Notebook">+</button>
        <button class="action-icon-btn btn-delete-nb" title="Delete Notebook">✕</button>
      </div>
    `;

    // Toggle collapse
    headerEl.querySelector('.notebook-info').addEventListener('click', () => {
      if (state.collapsedNotebooks.has(nb.id)) {
        state.collapsedNotebooks.delete(nb.id);
      } else {
        state.collapsedNotebooks.add(nb.id);
      }
      state.activeNotebookId = nb.id;
      renderNav();
    });

    // Add page quick button
    headerEl.querySelector('.btn-add-page').addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeNotebookId = nb.id;
      showModal(`New Page for "${nb.title}"`, 'Page Title...', (title) => {
        vscode.postMessage({ type: 'createPage', notebookId: nb.id, title });
      });
    });

    // Delete notebook button
    headerEl.querySelector('.btn-delete-nb').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete notebook "${nb.title}" and all its pages?`)) {
        vscode.postMessage({ type: 'deleteNotebook', id: nb.id });
        if (state.activeNotebookId === nb.id) {
          state.activeNotebookId = null;
          state.activePageId = null;
          closeEditor();
        }
      }
    });

    nbEl.appendChild(headerEl);

    // Pages container
    const pagesEl = document.createElement('div');
    pagesEl.className = 'pages-container';

    if (pages.length === 0) {
      pagesEl.innerHTML = `<div style="padding: 6px 8px; font-size: 11px; color: var(--text-muted); font-style: italic;">No pages yet.</div>`;
    } else {
      pages.forEach((page) => {
        const isActivePage = state.activePageId === page.id;
        const pageEl = document.createElement('div');
        pageEl.className = `page-item ${isActivePage ? 'active-page' : ''}`;
        pageEl.innerHTML = `
          <div class="page-info">
            ${page.isPinned ? '<span class="page-pin-indicator" title="Pinned">📌</span>' : ''}
            <span class="page-title-text">${escapeHtml(page.title || 'Untitled')}</span>
          </div>
          <div class="page-meta">${formatRelativeTime(page.updatedAt)}</div>
          <div class="page-actions">
            <button class="action-icon-btn btn-pin-item" title="${page.isPinned ? 'Unpin' : 'Pin'}">${page.isPinned ? '★' : '☆'}</button>
            <button class="action-icon-btn btn-del-item" title="Delete Page">✕</button>
          </div>
        `;

        pageEl.addEventListener('click', () => {
          openPage(nb.id, page.id);
        });

        pageEl.querySelector('.btn-pin-item').addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'togglePinPage',
            notebookId: nb.id,
            pageId: page.id,
          });
        });

        pageEl.querySelector('.btn-del-item').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete page "${page.title}"?`)) {
            vscode.postMessage({
              type: 'deletePage',
              notebookId: nb.id,
              pageId: page.id,
            });
            if (state.activePageId === page.id) {
              closeEditor();
            }
          }
        });

        pagesEl.appendChild(pageEl);
      });
    }

    nbEl.appendChild(pagesEl);
    elements.navPanel.appendChild(nbEl);
  });
}

// =============================================================================
// Editor Management
// =============================================================================

function openPage(notebookId, pageId) {
  state.activeNotebookId = notebookId;
  state.activePageId = pageId;

  const page = getActivePage();
  if (!page) return;

  elements.editorTitleInput.value = page.title;
  elements.editorTextarea.value = page.content || '';
  updatePinButton(page.isPinned);
  updateStats();

  elements.navPanel.style.display = 'none';
  elements.editorPanel.classList.add('open');

  setEditorTab(state.activeTab);
  renderNav();
}

function refreshActivePage() {
  const page = getActivePage();
  if (!page) {
    closeEditor();
    return;
  }
  // Only update if not actively focused by user to prevent typing jumps
  if (document.activeElement !== elements.editorTextarea && document.activeElement !== elements.editorTitleInput) {
    elements.editorTitleInput.value = page.title;
    elements.editorTextarea.value = page.content || '';
    updatePinButton(page.isPinned);
    updateStats();
    if (state.activeTab === 'preview') {
      renderMarkdownPreview();
    }
  }
}

function closeEditor() {
  state.activePageId = null;
  elements.editorPanel.classList.remove('open');
  elements.navPanel.style.display = 'block';
  renderNav();
}

function getActivePage() {
  if (!state.activeNotebookId || !state.activePageId) return null;
  const nb = (state.data.notebooks || []).find((n) => n.id === state.activeNotebookId);
  if (!nb) return null;
  return (nb.pages || []).find((p) => p.id === state.activePageId);
}

function updatePinButton(isPinned) {
  if (isPinned) {
    elements.btnPinPage.innerHTML = '📌 Sabitlendi';
    elements.btnPinPage.style.borderColor = 'var(--text-primary)';
  } else {
    elements.btnPinPage.innerHTML = '☆ Sabitle';
    elements.btnPinPage.style.borderColor = 'var(--border-color)';
  }
}

function setEditorTab(tab) {
  state.activeTab = tab;
  if (tab === 'write') {
    elements.tabWrite.classList.add('active');
    elements.tabPreview.classList.remove('active');
    elements.editorTextarea.style.display = 'block';
    elements.editorPreview.classList.remove('active');
    elements.editorTextarea.focus();
  } else {
    elements.tabWrite.classList.remove('active');
    elements.tabPreview.classList.add('active');
    elements.editorTextarea.style.display = 'none';
    elements.editorPreview.classList.add('active');
    renderMarkdownPreview();
  }
}

function handleContentChange() {
  elements.saveDot.classList.remove('saved');
  elements.saveStatus.innerText = 'Kaydediliyor...';
  updateStats();

  if (state.saveTimeout) {
    clearTimeout(state.saveTimeout);
  }

  state.saveTimeout = setTimeout(() => {
    saveCurrentPage();
  }, 400); // 400ms debounce
}

function saveCurrentPage() {
  if (!state.activeNotebookId || !state.activePageId) return;

  const title = elements.editorTitleInput.value.trim() || 'Untitled Page';
  const content = elements.editorTextarea.value;

  vscode.postMessage({
    type: 'updatePage',
    notebookId: state.activeNotebookId,
    pageId: state.activePageId,
    title: title,
    content: content,
  });

  elements.saveDot.classList.add('saved');
  elements.saveStatus.innerText = 'Saved';

  // Also update local model in memory for instant feedback
  const page = getActivePage();
  if (page) {
    page.title = title;
    page.content = content;
    page.updatedAt = Date.now();
  }
}

function updateStats() {
  const text = elements.editorTextarea.value || '';
  const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars = text.length;
  elements.footerStats.innerText = `${words} words · ${chars} characters`;
}

// =============================================================================
// Markdown Parser (Ultra-Clean & Fast Monokrom)
// =============================================================================

function renderMarkdownPreview() {
  const raw = elements.editorTextarea.value || '';
  elements.editorPreview.innerHTML = parseMarkdown(raw);
}

function parseMarkdown(md) {
  if (!md.trim()) {
    return '<p style="color: var(--text-muted); font-style: italic;">Note content is empty. Switch to "Write" tab to start typing.</p>';
  }

  let html = escapeHtml(md);

  // Fenced Code blocks
  html = html.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Horizontal Rule
  html = html.replace(/^---$/gim, '<hr>');

  // Checkboxes
  html = html.replace(/^- \[x\] (.*$)/gim, '<div>☑ <strong>$1</strong></div>');
  html = html.replace(/^- \[ \] (.*$)/gim, '<div>☐ $1</div>');

  // Unordered list items
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');

  // Wrap loose newlines in paragraphs
  const paragraphs = html
    .split(/\n{2,}/)
    .map((block) => {
      block = block.trim();
      if (!block) return '';
      if (
        block.startsWith('<h') ||
        block.startsWith('<pre') ||
        block.startsWith('<blockquote') ||
        block.startsWith('<hr') ||
        block.startsWith('<li>') ||
        block.startsWith('<div>')
      ) {
        return block;
      }
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return paragraphs;
}

// =============================================================================
// Modal Helpers
// =============================================================================

function showModal(title, placeholder, onConfirm) {
  elements.modalTitle.innerText = title;
  elements.modalInput.placeholder = placeholder;
  elements.modalInput.value = '';
  currentModalAction = onConfirm;
  elements.modalOverlay.classList.add('open');
  setTimeout(() => elements.modalInput.focus(), 50);
}

function hideModal() {
  elements.modalOverlay.classList.remove('open');
  elements.modalInput.value = '';
  currentModalAction = null;
}

function submitModal() {
  const value = elements.modalInput.value.trim();
  if (value && currentModalAction) {
    currentModalAction(value);
  }
  hideModal();
}

// =============================================================================
// Utility Functions
// =============================================================================

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  const date = new Date(timestamp);
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
