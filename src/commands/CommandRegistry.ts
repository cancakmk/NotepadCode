import * as vscode from 'vscode';
import { NotebookService } from '../services/NotebookService';
import { ExportImportService } from '../services/ExportImportService';
import { NotepadWebviewProvider } from '../controllers/NotepadWebviewProvider';
import { NotepadEditorPanel } from '../controllers/NotepadEditorPanel';

/**
 * Registers and wires all VS Code palette commands for Notepad Code.
 */
export class CommandRegistry {
  private readonly _context: vscode.ExtensionContext;
  private readonly _notebookService: NotebookService;
  private readonly _exportImportService: ExportImportService;
  private readonly _provider: NotepadWebviewProvider;

  constructor(
    context: vscode.ExtensionContext,
    notebookService: NotebookService,
    exportImportService: ExportImportService,
    provider: NotepadWebviewProvider
  ) {
    this._context = context;
    this._notebookService = notebookService;
    this._exportImportService = exportImportService;
    this._provider = provider;
  }

  public registerAll(): void {
    this._context.subscriptions.push(
      vscode.commands.registerCommand('notepadCode.openEditor', () => this._openEditor()),
      vscode.commands.registerCommand('notepadCode.newNotebook', () => this._newNotebook()),
      vscode.commands.registerCommand('notepadCode.createNotebook', () => this._newNotebook()),
      vscode.commands.registerCommand('notepadCode.newPage', () => this._newPage()),
      vscode.commands.registerCommand('notepadCode.createPage', () => this._newPage()),
      vscode.commands.registerCommand('notepadCode.exportNotes', () => this._exportNotes()),
      vscode.commands.registerCommand('notepadCode.importNotes', () => this._importNotes())
    );
  }

  private _openEditor(): void {
    NotepadEditorPanel.createOrShow(
      this._context.extensionUri,
      this._notebookService,
      this._exportImportService,
      undefined,
      undefined,
      () => this._provider.syncData()
    );
  }

  private async _newNotebook(): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: 'New Notebook Title',
      placeHolder: 'e.g.: Architecture Decisions, Ideas, Python Snippets...',
      validateInput: (text) => (!text.trim() ? 'Title cannot be empty' : null),
    });

    if (!title) return;

    await this._notebookService.createNotebook(title.trim());
    await this._provider.syncData();
    vscode.window.showInformationMessage(`Notebook "${title}" created.`);
  }

  private async _newPage(): Promise<void> {
    const notebooks = await this._notebookService.getAllNotebooks();
    if (notebooks.length === 0) {
      const createFirst = await vscode.window.showQuickPick(['Create New Notebook'], {
        placeHolder: 'You need to create a notebook first',
      });
      if (createFirst) {
        await this._newNotebook();
      }
      return;
    }

    const selectedNb = await vscode.window.showQuickPick(
      notebooks.map((nb) => ({
        label: `📓 ${nb.title}`,
        description: `${nb.pageCount} ${nb.pageCount === 1 ? 'page' : 'pages'}`,
        notebook: nb,
      })),
      { placeHolder: 'Select the notebook to add the page to' }
    );

    if (!selectedNb) return;

    const pageTitle = await vscode.window.showInputBox({
      prompt: `New page title in "${selectedNb.notebook.title}":`,
      placeHolder: 'e.g.: Meeting Notes, TODO list...',
      validateInput: (text) => (!text.trim() ? 'Page title cannot be empty' : null),
    });

    if (!pageTitle) return;

    const page = await this._notebookService.createPage(selectedNb.notebook.id, pageTitle.trim());
    await this._provider.syncData();
    this._provider.selectPage(selectedNb.notebook.id, page.id);
    NotepadEditorPanel.createOrShow(
      this._context.extensionUri,
      this._notebookService,
      this._exportImportService,
      selectedNb.notebook.id,
      page.id,
      () => this._provider.syncData()
    );
    vscode.window.showInformationMessage(`Page "${pageTitle}" created.`);
  }

  private async _exportNotes(): Promise<void> {
    await this._exportImportService.exportAllToJson();
  }

  private async _importNotes(): Promise<void> {
    const ok = await this._exportImportService.importFromJson();
    if (ok) {
      await this._provider.syncData();
    }
  }
}
