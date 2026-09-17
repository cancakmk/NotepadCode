import * as vscode from 'vscode';
import { NotebookService } from '../services/NotebookService';
import { ExportImportService } from '../services/ExportImportService';
import { contentToPlainText } from '../utils/noteContent';

export interface IToolContext {
  notebookService: NotebookService;
  exportImportService: ExportImportService;
  onDataChanged: () => void;
}

// ----------------------------------------------------------------------------
// 1. List Notebooks Tool
// ----------------------------------------------------------------------------
export class NotepadListNotebooksTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const notebooks = await this._ctx.notebookService.getAllNotebooks();
    const result = notebooks.map((nb) => ({
      id: nb.id,
      title: nb.title,
      description: nb.description,
      pageCount: nb.pageCount,
      pages: nb.getPages().map((p) => ({
        id: p.id,
        title: p.title,
        updatedAt: new Date(p.updatedAt).toLocaleString(),
      })),
    }));

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 2. Read Note Page Tool
// ----------------------------------------------------------------------------
export interface IReadPageInput {
  notebookId: string;
  pageId: string;
}

export class NotepadReadPageTool implements vscode.LanguageModelTool<IReadPageInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IReadPageInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { notebookId, pageId } = options.input;
    const notebook = await this._ctx.notebookService.getNotebook(notebookId);
    if (!notebook) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error: Notebook not found with ID "${notebookId}".`),
      ]);
    }

    const page = notebook.findPage(pageId);
    if (!page) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error: Page not found with ID "${pageId}" in notebook "${notebook.title}".`),
      ]);
    }

    const response = {
      notebookId: notebook.id,
      notebookTitle: notebook.title,
      pageId: page.id,
      title: page.title,
      content: contentToPlainText(page.content),
      wordCount: page.getWordCount(),
      characterCount: page.getCharacterCount(),
      updatedAt: new Date(page.updatedAt).toISOString(),
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(response, null, 2)),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 3. Search Notes Tool
// ----------------------------------------------------------------------------
export interface ISearchNotesInput {
  query: string;
}

export class NotepadSearchNotesTool implements vscode.LanguageModelTool<ISearchNotesInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISearchNotesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const results = await this._ctx.notebookService.search(options.input.query);
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(results, null, 2)),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 4. Create Notebook Tool
// ----------------------------------------------------------------------------
export interface ICreateNotebookInput {
  title: string;
  description?: string;
}

export class NotepadCreateNotebookTool implements vscode.LanguageModelTool<ICreateNotebookInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreateNotebookInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { title, description } = options.input;
    const notebook = await this._ctx.notebookService.createNotebook(title, description || '');
    this._ctx.onDataChanged();

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Successfully created notebook "${notebook.title}" (ID: ${notebook.id}).`
      ),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 5. Create Note Page Tool
// ----------------------------------------------------------------------------
export interface ICreatePageInput {
  notebookId: string;
  title: string;
  content?: string;
}

// ----------------------------------------------------------------------------
// Text Normalization (Enforces clean, normal plain text format - No Markdown)
// ----------------------------------------------------------------------------
function normalizeToPlainText(content: string, title?: string): string {
  if (!content || typeof content !== 'string') return '';

  let text = content;

  if (title) {
    const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^#+\\s*${escaped}\\s*\\n+`, 'i'), '');
    text = text.replace(new RegExp(`^${escaped}\\s*\\n[=\\-]{2,}\\s*\\n+`, 'i'), '');
  }

  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '');
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/g, '$1');
  text = text.replace(/```/g, '');
  text = text.replace(/^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.*?)\|[ \t]*$/gm, (_match, inner) => {
    const cells = inner.split('|').map((c: string) => c.trim()).filter(Boolean);
    return cells.join('  —  ');
  });
  text = text.replace(/^#{1,6}\s*(.+)$/gm, '$1');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(^|[^\w])\*([^\*\n]+)\*([^\w]|$)/g, '$1$2$3');
  text = text.replace(/(^|[^\w])_([^_\n]+)_([^\w]|$)/g, '$1$2$3');
  text = text.replace(/~~(.*?)~~/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    return label === url ? label : `${label} (${url})`;
  });
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*\*[ \t]+/gm, '• ');
  text = text.replace(/^[ \t]*-[ \t]+/gm, '• ');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

export class NotepadCreatePageTool implements vscode.LanguageModelTool<ICreatePageInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreatePageInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { notebookId, title, content } = options.input;
    const cleanTitle = title.trim();
    const cleanContent = normalizeToPlainText(content || '', cleanTitle);
    const page = await this._ctx.notebookService.createPage(notebookId, cleanTitle, cleanContent);
    this._ctx.onDataChanged();

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Successfully created note "${page.title}" (ID: ${page.id}) in notebook ${notebookId}.`
      ),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 6. Update Note Page Tool
// ----------------------------------------------------------------------------
export interface IUpdatePageInput {
  notebookId: string;
  pageId: string;
  title?: string;
  content?: string;
}

export class NotepadUpdatePageTool implements vscode.LanguageModelTool<IUpdatePageInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IUpdatePageInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { notebookId, pageId, title, content } = options.input;
    const notebook = await this._ctx.notebookService.getNotebook(notebookId);
    if (!notebook) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error: Notebook "${notebookId}" not found.`),
      ]);
    }

    const existingPage = notebook.findPage(pageId);
    if (!existingPage) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error: Page "${pageId}" not found in notebook "${notebook.title}".`),
      ]);
    }

    const updatedTitle = title !== undefined ? title.trim() : existingPage.title;
    const updatedContent = content !== undefined ? normalizeToPlainText(content, updatedTitle) : existingPage.content;

    const page = await this._ctx.notebookService.updatePage(
      notebookId,
      pageId,
      updatedTitle,
      updatedContent
    );
    this._ctx.onDataChanged();

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Successfully updated note "${page.title}" (ID: ${page.id}).`
      ),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 7. Rename Notebook Tool
// ----------------------------------------------------------------------------
export interface IRenameNotebookInput {
  notebookId: string;
  title: string;
}

export class NotepadRenameNotebookTool implements vscode.LanguageModelTool<IRenameNotebookInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IRenameNotebookInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { notebookId, title } = options.input;
    const notebook = await this._ctx.notebookService.updateNotebook(notebookId, title);
    this._ctx.onDataChanged();

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Successfully renamed notebook to "${notebook.title}" (ID: ${notebook.id}).`
      ),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 8. Delete Page Tool (⚠️ User Confirmation Required)
// ----------------------------------------------------------------------------
export interface IDeletePageInput {
  notebookId: string;
  pageId: string;
}

export class NotepadDeletePageTool implements vscode.LanguageModelTool<IDeletePageInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDeletePageInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { notebookId, pageId } = options.input;
    const notebook = await this._ctx.notebookService.getNotebook(notebookId);
    const page = notebook?.findPage(pageId);
    const pageTitle = page ? page.title : pageId;
    const nbTitle = notebook ? notebook.title : notebookId;

    return {
      invocationMessage: `Deleting note "${pageTitle}"...`,
      confirmationMessages: {
        title: 'Delete Note Page',
        message: new vscode.MarkdownString(
          `Note **"${pageTitle}"** in notebook **"${nbTitle}"** will be permanently deleted.\n\nDo you want to continue?`
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDeletePageInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { notebookId, pageId } = options.input;
    const success = await this._ctx.notebookService.deletePage(notebookId, pageId);
    if (!success) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Failed to delete page "${pageId}".`),
      ]);
    }

    this._ctx.onDataChanged();
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Successfully deleted note "${pageId}".`),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 9. Delete Notebook Tool (⚠️ User Confirmation Required)
// ----------------------------------------------------------------------------
export interface IDeleteNotebookInput {
  notebookId: string;
}

export class NotepadDeleteNotebookTool implements vscode.LanguageModelTool<IDeleteNotebookInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDeleteNotebookInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { notebookId } = options.input;
    const notebook = await this._ctx.notebookService.getNotebook(notebookId);
    const nbTitle = notebook ? notebook.title : notebookId;
    const count = notebook ? notebook.pageCount : 0;

    return {
      invocationMessage: `Deleting notebook "${nbTitle}"...`,
      confirmationMessages: {
        title: 'Delete Notebook',
        message: new vscode.MarkdownString(
          `⚠️ Notebook **"${nbTitle}"** and all its **${count}** pages will be permanently deleted.\n\nThis action cannot be undone. Are you sure you want to continue?`
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDeleteNotebookInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { notebookId } = options.input;
    const success = await this._ctx.notebookService.deleteNotebook(notebookId);
    if (!success) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Failed to delete notebook "${notebookId}".`),
      ]);
    }

    this._ctx.onDataChanged();
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Successfully deleted notebook "${notebookId}".`),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 10. Export Notes Tool
// ----------------------------------------------------------------------------
export class NotepadExportNotesTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private readonly _ctx: IToolContext) {}

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const jsonString = await this._ctx.exportImportService.exportDataToString();
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(jsonString),
    ]);
  }
}

// ----------------------------------------------------------------------------
// 11. Import Notes Tool (⚠️ User Confirmation Required)
// ----------------------------------------------------------------------------
export interface IImportNotesInput {
  jsonData: string;
}

export class NotepadImportNotesTool implements vscode.LanguageModelTool<IImportNotesInput> {
  constructor(private readonly _ctx: IToolContext) {}

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IImportNotesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Importing notes...',
      confirmationMessages: {
        title: 'Import Notes',
        message: new vscode.MarkdownString(
          `⚠️ Importing notes may overwrite or merge with your current notes.\n\nDo you confirm this action?`
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IImportNotesInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      await this._ctx.exportImportService.importDataFromString(options.input.jsonData);
      this._ctx.onDataChanged();
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('Notes successfully imported into Notepad Code.'),
      ]);
    } catch (err: any) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Failed to import notes: ${err.message}`),
      ]);
    }
  }
}
