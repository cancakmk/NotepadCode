import * as vscode from 'vscode';
import { NotebookService } from '../services/NotebookService';
import { ExportImportService } from '../services/ExportImportService';
import { WebviewMessageToExtension } from '../models/types';
import { getSidebarHtml } from '../webview/getSidebarHtml';
import { NotepadEditorPanel } from './NotepadEditorPanel';

/**
 * Controller providing the Notepad Code Explorer Webview inside the VS Code Activity Bar / Sidebar.
 */
export class NotepadWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'notepadCode.sidebarView';

  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private readonly _notebookService: NotebookService;
  private readonly _exportImportService: ExportImportService;

  constructor(
    extensionUri: vscode.Uri,
    notebookService: NotebookService,
    exportImportService: ExportImportService
  ) {
    this._extensionUri = extensionUri;
    this._notebookService = notebookService;
    this._exportImportService = exportImportService;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = getSidebarHtml(webviewView.webview, this._extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessageToExtension) => {
      await this._handleMessage(message);
    });

    // Initial sync
    this.syncData();

    // Handle view visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.syncData();
      }
    });
  }

  public async syncData(): Promise<void> {
    if (!this._view) {
      return;
    }
    const data = await this._notebookService.getStorageData();
    this._view.webview.postMessage({
      type: 'syncData',
      data: data,
    });
  }

  public selectPage(notebookId: string, pageId: string): void {
    if (!this._view) return;
    this._view.webview.postMessage({
      type: 'pageSelected',
      notebookId,
      pageId,
    });
  }

  private async _handleMessage(message: WebviewMessageToExtension): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.syncData();
          break;

        case 'createNotebook':
          await this._notebookService.createNotebook(message.title, message.description);
          await this.syncData();
          this._syncEditorPanel();
          break;

        case 'updateNotebook':
          await this._notebookService.updateNotebook(message.id, message.title, message.description);
          await this.syncData();
          this._syncEditorPanel();
          break;

        case 'deleteNotebook': {
          const nb = await this._notebookService.getNotebook(message.id);
          const title = nb ? nb.title : 'this notebook';
          const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete notebook "${title}" and all its pages?`,
            { modal: true },
            'Delete Notebook'
          );
          if (confirmed === 'Delete Notebook') {
            await this._notebookService.deleteNotebook(message.id);
            await this.syncData();
            this._syncEditorPanel();
          }
          break;
        }

        case 'createPage':
          const page = await this._notebookService.createPage(message.notebookId, message.title, message.content);
          await this.syncData();
          this.selectPage(message.notebookId, page.id);
          // Automatically open newly created page in a new editor tab
          NotepadEditorPanel.createOrShow(
            this._extensionUri,
            this._notebookService,
            this._exportImportService,
            message.notebookId,
            page.id,
            () => this.syncData()
          );
          break;

        case 'updatePage':
          await this._notebookService.updatePage(
            message.notebookId,
            message.pageId,
            message.title,
            message.content
          );
          this._syncEditorPanel();
          break;

        case 'deletePage': {
          const nb = await this._notebookService.getNotebook(message.notebookId);
          const pageItem = nb?.findPage(message.pageId);
          const title = pageItem ? pageItem.title : 'this page';
          const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete page "${title}"?`,
            { modal: true },
            'Delete Page'
          );
          if (confirmed === 'Delete Page') {
            await this._notebookService.deletePage(message.notebookId, message.pageId);
            await this.syncData();
            this._syncEditorPanel();
          }
          break;
        }

        case 'openInEditor':
          NotepadEditorPanel.createOrShow(
            this._extensionUri,
            this._notebookService,
            this._exportImportService,
            message.notebookId,
            message.pageId,
            () => this.syncData()
          );
          break;

        case 'reorderNotebooks':
          await this._notebookService.reorderNotebooks(message.notebookIds);
          this._syncEditorPanel();
          break;

        case 'reorderPages':
          await this._notebookService.reorderPages(message.notebookId, message.pageIds);
          this._syncEditorPanel();
          break;

        case 'exportData':
          await this._exportImportService.exportAllToJson();
          break;

        case 'importData':
          const success = await this._exportImportService.importFromJson();
          if (success) {
            await this.syncData();
            this._syncEditorPanel();
          }
          break;
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Notepad Code Error: ${error.message}`);
    }
  }

  private _syncEditorPanel(): void {
    if (NotepadEditorPanel.currentPanel) {
      NotepadEditorPanel.currentPanel.syncData();
    }
  }
}
