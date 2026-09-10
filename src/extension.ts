import * as vscode from 'vscode';
import { FileNotebookRepository } from './repositories/FileNotebookRepository';
import { NotebookService } from './services/NotebookService';
import { ExportImportService } from './services/ExportImportService';
import { NotepadWebviewProvider } from './controllers/NotepadWebviewProvider';
import { NotepadEditorPanel } from './controllers/NotepadEditorPanel';
import { CommandRegistry } from './commands/CommandRegistry';
import {
  NotepadListNotebooksTool,
  NotepadReadPageTool,
  NotepadSearchNotesTool,
  NotepadCreateNotebookTool,
  NotepadCreatePageTool,
  NotepadUpdatePageTool,
  NotepadRenameNotebookTool,
  NotepadDeletePageTool,
  NotepadDeleteNotebookTool,
  NotepadExportNotesTool,
  NotepadImportNotesTool,
} from './copilot/NotepadTools';
import { registerNotepadChatParticipant } from './copilot/NotepadChatParticipant';
import { McpAutoConfigService } from './services/McpAutoConfigService';

/**
 * Extension entry point.
 * Bootstraps Dependency Injection, registers controllers and commands.
 */
export async function activate(context: vscode.ExtensionContext) {
  // 1. Initialize Persistence Layer (Global storage across workspaces)
  const repository = new FileNotebookRepository(context.globalStorageUri);
  context.subscriptions.push(repository);
  await repository.initialize();

  // 2. Initialize Business Logic Services
  const notebookService = new NotebookService(repository);
  const exportImportService = new ExportImportService(repository);

  // 3. Initialize Controllers & Webview Providers
  const webviewProvider = new NotepadWebviewProvider(
    context.extensionUri,
    notebookService,
    exportImportService
  );

  // 4. Real-time disk sync: automatically update UI when MCP, Cursor or Antigravity writes changes
  repository.onDidChangeData(() => {
    webviewProvider.syncData();
    NotepadEditorPanel.currentPanel?.syncData();
  });

  // 4. Register Activity Bar / Sidebar View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      NotepadWebviewProvider.viewType,
      webviewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // 5. Register Palette & Shortcut Commands
  const commandRegistry = new CommandRegistry(
    context,
    notebookService,
    exportImportService,
    webviewProvider
  );
  commandRegistry.registerAll();

  // 6. Register VS Code Copilot Language Model Tools
  const toolContext = {
    notebookService,
    exportImportService,
    onDataChanged: () => webviewProvider.syncData(),
  };

  if (vscode.lm && typeof vscode.lm.registerTool === 'function') {
    context.subscriptions.push(
      vscode.lm.registerTool('notepad_list_notebooks', new NotepadListNotebooksTool(toolContext)),
      vscode.lm.registerTool('notepad_read_page', new NotepadReadPageTool(toolContext)),
      vscode.lm.registerTool('notepad_search_notes', new NotepadSearchNotesTool(toolContext)),
      vscode.lm.registerTool('notepad_create_notebook', new NotepadCreateNotebookTool(toolContext)),
      vscode.lm.registerTool('notepad_create_page', new NotepadCreatePageTool(toolContext)),
      vscode.lm.registerTool('notepad_update_page', new NotepadUpdatePageTool(toolContext)),
      vscode.lm.registerTool('notepad_rename_notebook', new NotepadRenameNotebookTool(toolContext)),
      vscode.lm.registerTool('notepad_delete_page', new NotepadDeletePageTool(toolContext)),
      vscode.lm.registerTool('notepad_delete_notebook', new NotepadDeleteNotebookTool(toolContext)),
      vscode.lm.registerTool('notepad_export_notes', new NotepadExportNotesTool(toolContext)),
      vscode.lm.registerTool('notepad_import_notes', new NotepadImportNotesTool(toolContext))
    );
  }

  // 7. Register @notepad Chat Participant
  if (vscode.chat && typeof vscode.chat.createChatParticipant === 'function') {
    context.subscriptions.push(
      registerNotepadChatParticipant(context, notebookService, exportImportService, () =>
        webviewProvider.syncData()
      )
    );
  }

  // 8. Automatically configure MCP across IDEs (Cursor, Antigravity, Windsurf, Claude) with zero user intervention
  McpAutoConfigService.autoConfigureAll(context).catch((err) => {
    console.warn('[NotepadCode] MCP auto-configuration background task encountered an error:', err);
  });

  console.log('Notepad Code extension successfully activated with global workspace storage, Copilot integration, and multi-IDE MCP auto-config.');
}

export function deactivate() {
  // Clean-up if needed
}
