import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Notebook } from '../models/Notebook';
import { Page } from '../models/Page';
import { INotebookDTO, IStorageData } from '../models/types';
import { INotebookRepository } from './INotebookRepository';

/**
 * Concrete implementation of INotebookRepository utilizing centralized storage (~/.notepad-code/).
 * Ensures data is seamlessly available across VS Code, Cursor, Antigravity, and MCP tools.
 */
export class FileNotebookRepository implements INotebookRepository, vscode.Disposable {
  private static readonly STORAGE_VERSION = 1;
  private static readonly DATA_FILE_NAME = 'notepad-code-data.json';

  private readonly _storageUri: vscode.Uri;
  private readonly _dataFileUri: vscode.Uri;
  private readonly _centralDir: string;
  private readonly _centralFilePath: string;

  private readonly _onDidChangeData = new vscode.EventEmitter<void>();
  public readonly onDidChangeData: vscode.Event<void> = this._onDidChangeData.event;

  private _fileWatcher?: fs.FSWatcher;
  private _pollInterval?: NodeJS.Timeout;
  private _debounceTimer?: NodeJS.Timeout;

  private _cache: Map<string, Notebook> = new Map();
  private _isInitialized: boolean = false;
  private _lastMtime: number = 0;
  private _writePromise: Promise<void> = Promise.resolve();

  constructor(globalStorageUri: vscode.Uri) {
    this._storageUri = globalStorageUri;
    this._dataFileUri = vscode.Uri.joinPath(globalStorageUri, FileNotebookRepository.DATA_FILE_NAME);
    this._centralDir = path.join(os.homedir(), '.notepad-code');
    this._centralFilePath = path.join(this._centralDir, FileNotebookRepository.DATA_FILE_NAME);
  }

  public async initialize(): Promise<void> {
    if (this._isInitialized) {
      await this._syncFromDiskIfModified();
      return;
    }

    this._isInitialized = true;

    try {
      if (!fs.existsSync(this._centralDir)) {
        fs.mkdirSync(this._centralDir, { recursive: true });
      }
    } catch {
      // Directory creation handled
    }

    try {
      // 1. Check central storage (~/.notepad-code/)
      if (fs.existsSync(this._centralFilePath)) {
        const content = fs.readFileSync(this._centralFilePath, 'utf8');
        const data: IStorageData = JSON.parse(content);
        this._populateCache(data);
        this._lastMtime = fs.statSync(this._centralFilePath).mtimeMs;
      } else {
        // 2. Fallback / Migration from VS Code globalStorage
        try {
          const fileBytes = await vscode.workspace.fs.readFile(this._dataFileUri);
          const content = new TextDecoder().decode(fileBytes);
          const data: IStorageData = JSON.parse(content);
          this._populateCache(data);
          fs.writeFileSync(this._centralFilePath, JSON.stringify(data, null, 2), 'utf8');
          this._lastMtime = fs.statSync(this._centralFilePath).mtimeMs;
        } catch {
          // 3. First time run: create default starter data
          await this._createDefaultStarterData();
        }
      }
    } catch {
      await this._createDefaultStarterData();
    } finally {
      this._startWatchingDisk();
    }
  }

  private _startWatchingDisk(): void {
    if (this._fileWatcher || this._pollInterval) {
      return;
    }

    // 1. fs.watch on central file or directory
    try {
      if (fs.existsSync(this._centralFilePath)) {
        this._fileWatcher = fs.watch(this._centralFilePath, () => {
          this._handleDiskChange();
        });
      } else if (fs.existsSync(this._centralDir)) {
        this._fileWatcher = fs.watch(this._centralDir, (_event, filename) => {
          if (!filename || filename === FileNotebookRepository.DATA_FILE_NAME) {
            this._handleDiskChange();
          }
        });
      }
    } catch (err) {
      console.warn('[NotepadCode] fs.watch setup error, relying on poll:', err);
    }

    // 2. Periodic poll fallback (1.5s) to guarantee updates regardless of OS filesystem events
    this._pollInterval = setInterval(() => {
      this._handleDiskChange();
    }, 1500);
  }

  private _handleDiskChange(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(async () => {
      const updated = await this._syncFromDiskIfModified();
      if (updated) {
        this._onDidChangeData.fire();
      }
    }, 80);
  }

  public dispose(): void {
    if (this._fileWatcher) {
      this._fileWatcher.close();
      this._fileWatcher = undefined;
    }
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = undefined;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    this._onDidChangeData.dispose();
  }

  private _populateCache(data: IStorageData): void {
    this._cache.clear();
    if (Array.isArray(data.notebooks)) {
      for (const nbDto of data.notebooks) {
        const notebook = Notebook.fromJSON(nbDto);
        this._cache.set(notebook.id, notebook);
      }
    }
  }

  private async _syncFromDiskIfModified(): Promise<boolean> {
    try {
      if (fs.existsSync(this._centralFilePath)) {
        const stat = fs.statSync(this._centralFilePath);
        if (stat.mtimeMs > this._lastMtime) {
          const content = fs.readFileSync(this._centralFilePath, 'utf8');
          const data: IStorageData = JSON.parse(content);
          this._populateCache(data);
          this._lastMtime = stat.mtimeMs;
          return true;
        }
      }
    } catch (err) {
      console.error('Failed to sync Notepad Code data from central disk:', err);
    }
    return false;
  }

  private async _createDefaultStarterData(): Promise<void> {
    this._cache.clear();

    const starterNotebook = Notebook.create(
      'Notepad Code',
      'Hoş Geldiniz! / Welcome to Notepad Code'
    );

    const welcomePage = Page.create(
      starterNotebook.id,
      'Başlangıç Kılavuzu',
      `Notepad Code'a Hoş Geldiniz!

Notepad Code, tüm çalışma alanlarında ortak çalışan, VS Code temanızla kusursuz uyum sağlayan profesyonel not defterinizdir.

Öne Çıkan Özellikler:
• Evrensel Depolama: Farklı projelerde çalışsanız dahi tüm notlarınız tek bir merkezde kalır.
• Defter & Sayfa Düzeni: Soldaki gezginden defterlerinizi ve altındaki sayfalarınızı yönetin.
• Geniş Editör Sayfası: Notlarınızı kenar çubuğunda sıkışmadan, geniş bir editör sekmesinde rahatça yazın.
• Otomatik Kayıt: Siz yazdıkça notlarınız anında ve kesintisiz kaydedilir.
• Canlı Arama: Arama çubuğu ile tüm notlarınız arasında anında filtreleme yapın.

İpuçları:
• Yeni defter veya sayfa eklemek için sol üstteki minimalist butonları kullanabilirsiniz.
• Önemli notları listenin en üstünde tutmak için sabitleyebilirsiniz.`
    );

    const snippetPage = Page.create(
      starterNotebook.id,
      'Fikirler ve Notlar',
      `Proje Fikirleri ve Hatırlatmalar

Buraya günlük çalışma notlarınızı, mimari kararlarınızı veya TODO maddelerinizi doğrudan yazabilirsiniz:

- UI tasarımını minimalist tut
- Yeni özellikleri test et
- Dokümantasyonu güncelle`
    );

    welcomePage.setPinned(true);
    starterNotebook.addPage(welcomePage);
    starterNotebook.addPage(snippetPage);

    this._cache.set(starterNotebook.id, starterNotebook);
    await this._persist();
  }

  public async getAllNotebooks(): Promise<Notebook[]> {
    await this.initialize();
    await this._syncFromDiskIfModified();
    return Array.from(this._cache.values());
  }

  public async getNotebookById(id: string): Promise<Notebook | undefined> {
    await this.initialize();
    await this._syncFromDiskIfModified();
    return this._cache.get(id);
  }

  public async saveNotebook(notebook: Notebook): Promise<void> {
    await this.initialize();
    if (!this._cache.has(notebook.id)) {
      const newCache = new Map<string, Notebook>();
      newCache.set(notebook.id, notebook);
      for (const [id, nb] of this._cache) {
        newCache.set(id, nb);
      }
      this._cache = newCache;
    } else {
      this._cache.set(notebook.id, notebook);
    }
    await this._persist();
  }

  public async deleteNotebook(id: string): Promise<boolean> {
    await this.initialize();
    const deleted = this._cache.delete(id);
    if (deleted) {
      await this._persist();
    }
    return deleted;
  }

  public async reorderNotebooks(orderedNotebookIds: string[]): Promise<void> {
    await this.initialize();
    const newCache = new Map<string, Notebook>();
    for (const id of orderedNotebookIds) {
      const nb = this._cache.get(id);
      if (nb) {
        newCache.set(id, nb);
      }
    }
    for (const [id, nb] of this._cache) {
      if (!newCache.has(id)) {
        newCache.set(id, nb);
      }
    }
    this._cache = newCache;
    await this._persist();
  }

  public async reorderPages(notebookId: string, orderedPageIds: string[]): Promise<void> {
    await this.initialize();
    const nb = this._cache.get(notebookId);
    if (nb) {
      nb.reorderPages(orderedPageIds);
      await this._persist();
    }
  }

  public async savePage(page: Page): Promise<void> {
    await this.initialize();
    const notebook = this._cache.get(page.notebookId);
    if (!notebook) {
      throw new Error(`Notebook not found: ${page.notebookId}`);
    }
    notebook.addPage(page);
    await this._persist();
  }

  public async deletePage(notebookId: string, pageId: string): Promise<boolean> {
    await this.initialize();
    const notebook = this._cache.get(notebookId);
    if (!notebook) {
      return false;
    }
    const deleted = notebook.removePage(pageId);
    if (deleted) {
      await this._persist();
    }
    return deleted;
  }

  public async getRawData(): Promise<IStorageData> {
    await this.initialize();
    return {
      version: FileNotebookRepository.STORAGE_VERSION,
      notebooks: Array.from(this._cache.values()).map((nb) => nb.toJSON()),
    };
  }

  public async importRawData(data: IStorageData): Promise<void> {
    await this.initialize();
    this._cache.clear();

    if (Array.isArray(data.notebooks)) {
      for (const nbDto of data.notebooks) {
        const nb = Notebook.fromJSON(nbDto);
        this._cache.set(nb.id, nb);
      }
    }

    await this._persist();
  }

  /**
   * Queued asynchronous persist operation to prevent write collisions.
   */
  private async _persist(): Promise<void> {
    this._writePromise = this._writePromise.then(async () => {
      try {
        const rawData: IStorageData = {
          version: FileNotebookRepository.STORAGE_VERSION,
          notebooks: Array.from(this._cache.values()).map((nb) => nb.toJSON()),
        };
        const json = JSON.stringify(rawData, null, 2);

        // 1. Central storage (~/.notepad-code/)
        try {
          if (!fs.existsSync(this._centralDir)) {
            fs.mkdirSync(this._centralDir, { recursive: true });
          }
          fs.writeFileSync(this._centralFilePath, json, 'utf8');
          this._lastMtime = fs.statSync(this._centralFilePath).mtimeMs;
        } catch (e) {
          console.error('Failed to write central notepad data:', e);
        }

        // 2. VS Code globalStorage mirror
        try {
          const bytes = new TextEncoder().encode(json);
          await vscode.workspace.fs.writeFile(this._dataFileUri, bytes);
        } catch (e) {
          // May fail if editor context is unmounted
        }
      } catch (error) {
        console.error('Failed to persist Notepad Code data:', error);
      }
    });

    return this._writePromise;
  }
}
