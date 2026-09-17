import * as vscode from 'vscode';
import { NotebookService } from '../services/NotebookService';
import { ExportImportService } from '../services/ExportImportService';
import { WebviewMessageToExtension } from '../models/types';
import { getEditorHtml } from '../webview/getEditorHtml';

/**
 * Manages full-tab Webview Panels for focused, distraction-free note writing with editorial typography.
 */
export class NotepadEditorPanel {
  public static currentPanel: NotepadEditorPanel | undefined;
  public static readonly viewType = 'notepadCode.editorPanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _notebookService: NotebookService;
  private readonly _exportImportService: ExportImportService;
  private _disposables: vscode.Disposable[] = [];
  private _onDidUpdateData?: () => void;
  private _activeNotebookId?: string;
  private _activePageId?: string;
  private _isDisposed = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    notebookService: NotebookService,
    exportImportService: ExportImportService,
    initialNotebookId?: string,
    initialPageId?: string,
    onDidUpdateData?: () => void
  ): NotepadEditorPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (NotepadEditorPanel.currentPanel) {
      NotepadEditorPanel.currentPanel._panel.reveal(column);
      if (initialNotebookId && initialPageId) {
        void NotepadEditorPanel.currentPanel.selectPage(initialNotebookId, initialPageId);
      }
      return NotepadEditorPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      NotepadEditorPanel.viewType,
      'Notepad Code - Note Editor',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    NotepadEditorPanel.currentPanel = new NotepadEditorPanel(
      panel,
      extensionUri,
      notebookService,
      exportImportService,
      initialNotebookId,
      initialPageId,
      onDidUpdateData
    );

    return NotepadEditorPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    notebookService: NotebookService,
    exportImportService: ExportImportService,
    initialNotebookId?: string,
    initialPageId?: string,
    onDidUpdateData?: () => void
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._notebookService = notebookService;
    this._exportImportService = exportImportService;
    this._activeNotebookId = initialNotebookId;
    this._activePageId = initialPageId;
    this._onDidUpdateData = onDidUpdateData;

    this._panel.iconPath = {
      light: vscode.Uri.joinPath(this._extensionUri, 'media', 'notepad-icon-light.svg'),
      dark: vscode.Uri.joinPath(this._extensionUri, 'media', 'notepad-icon-dark.svg'),
    };
    this._panel.webview.html = getEditorHtml(this._panel.webview, this._extensionUri);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewMessageToExtension) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );

    // Initial sync
    this.syncData();
  }

  public async syncData(): Promise<void> {
    const data = await this._notebookService.getStorageData();
    this._panel.webview.postMessage({
      type: 'syncData',
      data: data,
    });

    if (!this._activeNotebookId || !this._activePageId) {
      return;
    }

    // The webview keeps its own copy of the data, so a deleted (or moved) page
    // must be signalled explicitly — otherwise the editor keeps showing stale
    // content and every keystroke would fail with "Page not found".
    const notebook = data.notebooks.find((nb) => nb.id === this._activeNotebookId);
    const page = notebook?.pages.find((p) => p.id === this._activePageId);

    if (page) {
      this._postPageSelected(this._activeNotebookId, this._activePageId);
    } else {
      this._clearActivePage();
    }
  }

  public async selectPage(notebookId: string, pageId: string): Promise<void> {
    this._activeNotebookId = notebookId;
    this._activePageId = pageId;

    // Also update tab title to current page name
    void this._updateTabTitle(notebookId, pageId);

    // Push fresh data first: the webview keeps its own in-memory copy, so pages
    // created after the panel was opened would otherwise not resolve.
    await this.syncData();
  }

  private _clearActivePage(): void {
    this._activeNotebookId = undefined;
    this._activePageId = undefined;
    this._panel.title = 'Notepad Code - Note Editor';
    this._panel.webview.postMessage({ type: 'pageCleared' });
  }

  private _postPageSelected(notebookId: string, pageId: string): void {
    this._panel.webview.postMessage({
      type: 'pageSelected',
      notebookId,
      pageId,
    });
  }

  private async _updateTabTitle(notebookId: string, pageId: string): Promise<void> {
    const nb = await this._notebookService.getNotebook(notebookId);
    if (nb) {
      const page = nb.findPage(pageId);
      if (page) {
        this._panel.title = page.title || 'Untitled Note';
      }
    }
  }

  private async _handleMessage(message: WebviewMessageToExtension): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          // syncData() also re-posts the active page selection once ids are set
          await this.syncData();
          break;

        case 'updatePage':
          await this._notebookService.updatePage(
            message.notebookId,
            message.pageId,
            message.title,
            message.content
          );
          this._updateTabTitle(message.notebookId, message.pageId);
          this._notifyUpdate();
          break;

        case 'deletePage': {
          const nb = await this._notebookService.getNotebook(message.notebookId);
          const page = nb?.findPage(message.pageId);
          const title = page ? page.title : 'this page';
          const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete page "${title}"?`,
            { modal: true },
            'Delete Page'
          );
          if (confirmed === 'Delete Page') {
            await this._notebookService.deletePage(message.notebookId, message.pageId);
            this._notifyUpdate();
            this.dispose();
          }
          break;
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Notepad Code Error: ${error.message}`);
    }
  }

  private _notifyUpdate(): void {
    if (this._onDidUpdateData) {
      this._onDidUpdateData();
    }
  }

  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;

    if (NotepadEditorPanel.currentPanel === this) {
      NotepadEditorPanel.currentPanel = undefined;
    }
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
