import * as vscode from 'vscode';
import { INotebookRepository } from '../repositories/INotebookRepository';
import { IStorageData } from '../models/types';

/**
 * Service for handling data backups, JSON import/export, and Markdown generation.
 */
export class ExportImportService {
  private readonly _repository: INotebookRepository;

  constructor(repository: INotebookRepository) {
    this._repository = repository;
  }

  public async exportAllToJson(): Promise<void> {
    const data = await this._repository.getRawData();
    const json = JSON.stringify(data, null, 2);

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`notepad-code-backup-${new Date().toISOString().slice(0, 10)}.json`),
      filters: {
        'JSON Files': ['json'],
      },
    });

    if (saveUri) {
      await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(json));
      vscode.window.showInformationMessage('Notepad Code: All notes successfully exported!');
    }
  }

  public async importFromJson(): Promise<boolean> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'JSON Files': ['json'],
      },
      openLabel: 'Import Notes',
    });

    if (!fileUris || fileUris.length === 0) {
      return false;
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(fileUris[0]);
      const content = new TextDecoder().decode(bytes);
      const data: IStorageData = JSON.parse(content);

      if (!data || !Array.isArray(data.notebooks)) {
        throw new Error('Invalid Notepad Code backup format.');
      }

      await this._repository.importRawData(data);
      vscode.window.showInformationMessage(`Notepad Code: Successfully imported ${data.notebooks.length} notebooks!`);
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Import failed: ${error.message}`);
      return false;
    }
  }

  public async exportDataToString(): Promise<string> {
    const data = await this._repository.getRawData();
    return JSON.stringify(data, null, 2);
  }

  public async importDataFromString(jsonString: string): Promise<boolean> {
    const data: IStorageData = JSON.parse(jsonString);
    if (!data || !Array.isArray(data.notebooks)) {
      throw new Error('Geçersiz Notepad Code yedek formatı. (Invalid backup format)');
    }
    await this._repository.importRawData(data);
    return true;
  }
}
