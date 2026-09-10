#!/usr/bin/env node
/**
 * Notepad Code - Model Context Protocol (MCP) Server
 * Enables Antigravity, Cursor, and other AI agents to manage notebooks and pages.
 * Supports zero external dependencies and runs anywhere with Node.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const STORAGE_DIR = path.join(os.homedir(), '.notepad-code');
const DATA_FILE = path.join(STORAGE_DIR, 'notepad-code-data.json');

// ----------------------------------------------------------------------------
// Storage Operations
// ----------------------------------------------------------------------------
function loadStorageData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Failed to read data file:', err);
  }

  return {
    version: 1,
    notebooks: [
      {
        id: 'nb-default',
        title: 'Notepad Code',
        description: 'Genel Notlar',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: [
          {
            id: 'page-default',
            notebookId: 'nb-default',
            title: 'Başlangıç Notu',
            content: 'Notepad Code eklentisi hem VS Code, hem Cursor hem de Antigravity ile entegre çalışır.',
            isPinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      }
    ]
  };
}

function saveStorageData(data) {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ----------------------------------------------------------------------------
// Tool Definitions
// ----------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'notepad_list_notebooks',
    description: 'Lists all user notebooks in Notepad Code with their IDs, titles, page counts, and page titles.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'notepad_read_page',
    description: 'Reads the title, full content, and word/character counts of a specific note page.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'ID of the notebook containing the page.' },
        pageId: { type: 'string', description: 'ID of the page to read.' }
      },
      required: ['notebookId', 'pageId']
    }
  },
  {
    name: 'notepad_search_notes',
    description: 'Searches for notes matching a text query across all notebooks and pages.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase.' }
      },
      required: ['query']
    }
  },
  {
    name: 'notepad_create_notebook',
    description: 'Creates a new notebook in Notepad Code.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the new notebook.' },
        description: { type: 'string', description: 'Optional description of the notebook.' }
      },
      required: ['title']
    }
  },
  {
    name: 'notepad_create_page',
    description: 'Creates a new note page with a title and content in NORMAL PLAIN TEXT format (NOT markdown syntax like #, ##, **, ```). Notepad Code uses clean plain text without markdown syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'ID of the notebook to create the page in.' },
        title: { type: 'string', description: 'Title of the note (plain text, no markdown).' },
        content: {
          type: 'string',
          description: 'Content of the note in NORMAL PLAIN TEXT format. CRITICAL: Do NOT use markdown syntax (no #, ##, **, ```, etc.). Write natural, clean text paragraphs and lists.'
        }
      },
      required: ['notebookId', 'title']
    }
  },
  {
    name: 'notepad_update_page',
    description: 'Updates the title and/or content of an existing note page in NORMAL PLAIN TEXT format (NOT markdown syntax like #, ##, **, ```).',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'ID of the notebook containing the page.' },
        pageId: { type: 'string', description: 'ID of the page to update.' },
        title: { type: 'string', description: 'New title of the note (plain text).' },
        content: {
          type: 'string',
          description: 'New text content in NORMAL PLAIN TEXT format (do not use markdown formatting #, **, ```).'
        }
      },
      required: ['notebookId', 'pageId']
    }
  },
  {
    name: 'notepad_rename_notebook',
    description: 'Renames an existing notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'ID of the notebook to rename.' },
        title: { type: 'string', description: 'New title of the notebook.' }
      },
      required: ['notebookId', 'title']
    }
  },
  {
    name: 'notepad_delete_page',
    description: 'Permanently deletes a specific note page from a notebook. CRITICAL: Requires confirm=true to prevent accidental data loss.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'ID of the notebook containing the page.' },
        pageId: { type: 'string', description: 'ID of the page to delete.' },
        confirm: { type: 'boolean', description: 'Set to true after getting explicit user confirmation to permanently delete this page.' }
      },
      required: ['notebookId', 'pageId']
    }
  },
  {
    name: 'notepad_delete_notebook',
    description: 'Permanently deletes an entire notebook and all of its pages. CRITICAL: Requires confirm=true to prevent accidental data loss.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'ID of the notebook to delete.' },
        confirm: { type: 'boolean', description: 'Set to true after getting explicit user confirmation to permanently delete this notebook.' }
      },
      required: ['notebookId']
    }
  },
  {
    name: 'notepad_export_notes',
    description: 'Exports all notebooks and notes as a JSON backup string.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'notepad_import_notes',
    description: 'Imports notebooks and notes from a JSON string. Overwrites existing data. CRITICAL: Requires confirm=true to prevent accidental data loss.',
    inputSchema: {
      type: 'object',
      properties: {
        jsonData: { type: 'string', description: 'JSON backup string to import.' },
        confirm: { type: 'boolean', description: 'Set to true after getting explicit user confirmation to overwrite notes.' }
      },
      required: ['jsonData']
    }
  }
];

// ----------------------------------------------------------------------------
// Text Normalization (Enforces clean, normal plain text format - No Markdown)
// ----------------------------------------------------------------------------
function normalizeToPlainText(content, title) {
  if (!content || typeof content !== 'string') return '';

  let text = content;

  // 1. If content starts with title as heading (e.g. "# Title" or "Title\n==="), remove it
  if (title) {
    const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^#+\\s*${escaped}\\s*\\n+`, 'i'), '');
    text = text.replace(new RegExp(`^${escaped}\\s*\\n[=\\-]{2,}\\s*\\n+`, 'i'), '');
  }

  // 2. Remove horizontal rules (--- or *** or ___ on their own line)
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '');

  // 3. Remove code block fences: ```lang\ncode\n``` -> keep code
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/g, '$1');
  text = text.replace(/```/g, '');

  // 4. Markdown tables: convert "| col1 | col2 |" to clean readable text
  text = text.replace(/^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.*?)\|[ \t]*$/gm, (_match, inner) => {
    const cells = inner.split('|').map((c) => c.trim()).filter(Boolean);
    return cells.join('  —  ');
  });

  // 5. Convert markdown headers: # Header -> Header
  text = text.replace(/^#{1,6}\s*(.+)$/gm, '$1');

  // 6. Convert bold and italic
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(^|[^\w])\*([^\*\n]+)\*([^\w]|$)/g, '$1$2$3');
  text = text.replace(/(^|[^\w])_([^_\n]+)_([^\w]|$)/g, '$1$2$3');

  // 7. Strikethrough: ~~text~~ -> text
  text = text.replace(/~~(.*?)~~/g, '$1');

  // 8. Inline code: `code` -> code
  text = text.replace(/`([^`]+)`/g, '$1');

  // 9. Links: [label](url) -> label (url) or label
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    return label === url ? label : `${label} (${url})`;
  });

  // 10. Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // 11. Blockquotes: > quote -> quote
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');

  // 12. Normalize bullet points: "* item" -> "• item"
  text = text.replace(/^[ \t]*\*[ \t]+/gm, '• ');
  text = text.replace(/^[ \t]*-[ \t]+/gm, '• ');

  // 13. Clean excess blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

// ----------------------------------------------------------------------------
// Tool Execution Logic
// ----------------------------------------------------------------------------
function executeTool(name, args) {
  const data = loadStorageData();

  switch (name) {
    case 'notepad_list_notebooks': {
      const summary = data.notebooks.map((nb) => ({
        id: nb.id,
        title: nb.title,
        description: nb.description || '',
        pageCount: (nb.pages || []).length,
        pages: (nb.pages || []).map((p) => ({
          id: p.id,
          title: p.title,
          updatedAt: new Date(p.updatedAt).toLocaleString()
        }))
      }));
      return JSON.stringify(summary, null, 2);
    }

    case 'notepad_read_page': {
      const nb = data.notebooks.find((n) => n.id === args.notebookId);
      if (!nb) return `Error: Notebook "${args.notebookId}" not found.`;
      const page = (nb.pages || []).find((p) => p.id === args.pageId);
      if (!page) return `Error: Page "${args.pageId}" not found in notebook "${nb.title}".`;

      const words = page.content.trim() ? page.content.trim().split(/\s+/).length : 0;
      return JSON.stringify({
        notebookId: nb.id,
        notebookTitle: nb.title,
        pageId: page.id,
        title: page.title,
        content: page.content,
        wordCount: words,
        characterCount: page.content.length,
        updatedAt: new Date(page.updatedAt).toISOString()
      }, null, 2);
    }

    case 'notepad_search_notes': {
      const q = (args.query || '').toLowerCase().trim();
      if (!q) return '[]';
      const results = [];
      for (const nb of data.notebooks) {
        for (const page of nb.pages || []) {
          const titleMatch = page.title.toLowerCase().includes(q);
          const contentMatch = page.content.toLowerCase().includes(q);
          if (titleMatch || contentMatch) {
            let snippet = '';
            if (contentMatch) {
              const idx = page.content.toLowerCase().indexOf(q);
              const start = Math.max(0, idx - 40);
              const end = Math.min(page.content.length, idx + q.length + 40);
              snippet = (start > 0 ? '...' : '') + page.content.substring(start, end).replace(/\n/g, ' ') + (end < page.content.length ? '...' : '');
            } else {
              snippet = page.content.substring(0, 80).replace(/\n/g, ' ') || 'No content';
            }
            results.push({
              notebookId: nb.id,
              notebookTitle: nb.title,
              pageId: page.id,
              pageTitle: page.title,
              matchedSnippet: snippet,
              isTitleMatch: titleMatch
            });
          }
        }
      }
      return JSON.stringify(results, null, 2);
    }

    case 'notepad_create_notebook': {
      const newId = `nb-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const newNb = {
        id: newId,
        title: args.title.trim(),
        description: (args.description || '').trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: [
          {
            id: `p-${Date.now()}`,
            notebookId: newId,
            title: 'Genel',
            content: '',
            isPinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      };
      data.notebooks.unshift(newNb);
      saveStorageData(data);
      return `Created notebook "${newNb.title}" with ID ${newNb.id}.`;
    }

    case 'notepad_create_page': {
      const nb = data.notebooks.find((n) => n.id === args.notebookId);
      if (!nb) return `Error: Notebook "${args.notebookId}" not found.`;
      const pageId = `p-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const title = (args.title || '').trim();
      const content = normalizeToPlainText(args.content || '', title);
      const newPage = {
        id: pageId,
        notebookId: nb.id,
        title: title,
        content: content,
        isPinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      nb.pages = nb.pages || [];
      nb.pages.unshift(newPage);
      nb.updatedAt = Date.now();
      saveStorageData(data);
      return `Created note "${newPage.title}" with ID ${newPage.id} in notebook "${nb.title}".`;
    }

    case 'notepad_update_page': {
      const nb = data.notebooks.find((n) => n.id === args.notebookId);
      if (!nb) return `Error: Notebook "${args.notebookId}" not found.`;
      const page = (nb.pages || []).find((p) => p.id === args.pageId);
      if (!page) return `Error: Page "${args.pageId}" not found.`;

      if (args.title !== undefined) page.title = args.title.trim();
      if (args.content !== undefined) page.content = normalizeToPlainText(args.content, page.title);
      page.updatedAt = Date.now();
      nb.updatedAt = Date.now();
      saveStorageData(data);
      return `Updated note "${page.title}" (${page.id}).`;
    }

    case 'notepad_rename_notebook': {
      const nb = data.notebooks.find((n) => n.id === args.notebookId);
      if (!nb) return `Error: Notebook "${args.notebookId}" not found.`;
      const oldTitle = nb.title;
      nb.title = args.title.trim();
      nb.updatedAt = Date.now();
      saveStorageData(data);
      return `Renamed notebook "${oldTitle}" to "${nb.title}".`;
    }

    case 'notepad_delete_page': {
      const nb = data.notebooks.find((n) => n.id === args.notebookId);
      if (!nb) return `Error: Notebook "${args.notebookId}" not found.`;
      const page = (nb.pages || []).find((p) => p.id === args.pageId);
      if (!page) return `Error: Page "${args.pageId}" not found.`;

      if (!args.confirm) {
        return `⚠️ ONAY GEREKİYOR (CONFIRMATION REQUIRED): "${nb.title}" defterindeki "${page.title}" başlıklı not kalıcı olarak silinecektir. Lütfen kullanıcıdan onay alıp 'confirm: true' parametresi ile tekrar çağırın.`;
      }

      nb.pages = nb.pages.filter((p) => p.id !== args.pageId);
      nb.updatedAt = Date.now();
      saveStorageData(data);
      return `Successfully deleted page "${page.title}" (${page.id}).`;
    }

    case 'notepad_delete_notebook': {
      const nb = data.notebooks.find((n) => n.id === args.notebookId);
      if (!nb) return `Error: Notebook "${args.notebookId}" not found.`;

      if (!args.confirm) {
        const pageCount = (nb.pages || []).length;
        return `⚠️ ONAY GEREKİYOR (CONFIRMATION REQUIRED): "${nb.title}" defteri ve içindeki ${pageCount} adet sayfa kalıcı olarak silinecektir. Lütfen kullanıcıdan onay alıp 'confirm: true' parametresi ile tekrar çağırın.`;
      }

      data.notebooks = data.notebooks.filter((n) => n.id !== args.notebookId);
      saveStorageData(data);
      return `Successfully deleted notebook "${nb.title}" (${nb.id}).`;
    }

    case 'notepad_export_notes': {
      return JSON.stringify(data, null, 2);
    }

    case 'notepad_import_notes': {
      if (!args.confirm) {
        return `⚠️ ONAY GEREKİYOR (CONFIRMATION REQUIRED): İçe aktarma işlemi mevcut notların üzerine yazacaktır. Lütfen kullanıcıdan onay alıp 'confirm: true' parametresi ile tekrar çağırın.`;
      }

      try {
        const imported = typeof args.jsonData === 'string' ? JSON.parse(args.jsonData) : args.jsonData;
        if (!imported || !Array.isArray(imported.notebooks)) {
          return 'Error: Invalid Notepad Code backup format.';
        }
        saveStorageData(imported);
        return `Successfully imported ${imported.notebooks.length} notebooks.`;
      } catch (err) {
        return `Import failed: ${err.message}`;
      }
    }

    default:
      return `Error: Unknown tool "${name}".`;
  }
}

// ----------------------------------------------------------------------------
// MCP JSON-RPC Server Implementation (stdio)
// ----------------------------------------------------------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result, error) {
  const res = { jsonrpc: '2.0', id };
  if (error) {
    res.error = error;
  } else {
    res.result = result;
  }
  process.stdout.write(JSON.stringify(res) + '\n');
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    return;
  }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'notepad-code',
        version: '1.0.0'
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // Notification, no reply needed
    return;
  }

  if (method === 'ping') {
    sendResponse(id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      const textOutput = executeTool(name, args || {});
      sendResponse(id, {
        content: [
          {
            type: 'text',
            text: textOutput
          }
        ]
      });
    } catch (err) {
      sendResponse(id, {
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${err.message}`
          }
        ],
        isError: true
      });
    }
    return;
  }

  if (id !== undefined) {
    sendResponse(id, null, {
      code: -32601,
      message: `Method not found: ${method}`
    });
  }
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
