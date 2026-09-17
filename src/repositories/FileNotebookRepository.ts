import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Notebook } from '../models/Notebook';
import { Page } from '../models/Page';
import { INotebookDTO, IStorageData } from '../models/types';
import { INotebookRepository } from './INotebookRepository';

/**
 * Concrete implementation of INotebookRepository utilizing centralized storage (~/.notepad-code/).
 * Ensures data is seamlessly available across VS Code, Cursor, Antigravity, and MCP tools.
 *
 * Multi-writer model: the extension and any MCP client (Cursor, Claude, ...) both
 * read-modify-write the same JSON file. Writes are atomic (temp + rename) and every
 * mutation re-reads the file first when its content changed (hash compared, not just
 * mtime), which keeps the lost-update window down to the milliseconds between that
 * check and the write. There is no cross-process lock, so a simultaneous write from
 * two editors can still overwrite a note — acceptable for a local notes store.
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
  private _lastSize: number = -1;
  private _lastSignature: string = '';
  private _storageUnsafe: boolean = false;
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
      await this._loadInitialData();
    } finally {
      this._startWatchingDisk();
    }
  }

  /**
   * Loads the initial state without ever destroying user data:
   * central file -> VS Code globalStorage mirror -> starter data.
   * A corrupt central file is quarantined (renamed aside), never overwritten.
   */
  private async _loadInitialData(): Promise<void> {
    if (fs.existsSync(this._centralFilePath)) {
      const file = this._readCentralFile();
      if (file) {
        this._populateCache(file.data);
        this._rememberFileSignature(file.content);
        return;
      }
      if (!this._quarantineCorruptFile()) {
        // The unreadable file could not be moved away: never write over it,
        // but still surface the mirrored copy so notes are not shown as empty.
        await this._loadFromMirror();
        return;
      }
    }

    // Fallback / migration from the VS Code globalStorage mirror
    if (await this._loadFromMirror()) {
      await this._persist();
      return;
    }

    await this._createDefaultStarterData();
  }

  /** Populates the cache from the VS Code globalStorage mirror, if it is usable. */
  private async _loadFromMirror(): Promise<boolean> {
    try {
      const fileBytes = await vscode.workspace.fs.readFile(this._dataFileUri);
      const data: IStorageData = JSON.parse(new TextDecoder().decode(fileBytes));
      this._populateCache(data);
      return true;
    } catch {
      return false; // No usable mirror
    }
  }

  private static _hash(content: string): string {
    return crypto.createHash('sha1').update(content).digest('hex');
  }

  private _readCentralFile(): { data: IStorageData; content: string } | null {
    try {
      const content = fs.readFileSync(this._centralFilePath, 'utf8');
      const data = JSON.parse(content);
      if (!data || !Array.isArray(data.notebooks)) {
        throw new Error('Unexpected data shape: "notebooks" array missing');
      }
      return { data: data as IStorageData, content };
    } catch (err) {
      console.error('[NotepadCode] Failed to parse the notes data file:', err);
      return null;
    }
  }

  private _rememberFileSignature(content: string): void {
    this._lastSignature = FileNotebookRepository._hash(content);
    try {
      const stat = fs.statSync(this._centralFilePath);
      this._lastMtime = stat.mtimeMs;
      this._lastSize = stat.size;
    } catch {
      this._lastMtime = 0;
      this._lastSize = -1;
    }
  }

  /**
   * Moves an unreadable data file aside so it can never be overwritten.
   * Returns false when the file could not be moved (writes must stay disabled).
   */
  private _quarantineCorruptFile(): boolean {
    const backupPath = `${this._centralFilePath}.corrupt-${Date.now()}.bak`;
    try {
      fs.renameSync(this._centralFilePath, backupPath);
    } catch (err) {
      this._storageUnsafe = true;
      console.error('[NotepadCode] Could not move the unreadable notes file aside. Saving is disabled to protect it.', err);
      vscode.window.showErrorMessage(
        'Notepad Code could not read your notes file and could not move it aside, so saving is disabled to avoid overwriting it. Please check permissions for ~/.notepad-code.'
      );
      return false;
    }

    const message =
      'Notepad Code could not read your notes file, so it was set aside as a backup and a fresh start was made.';
    console.warn(`[NotepadCode] ${message} Backup: ${backupPath}`);
    vscode.window.showWarningMessage(`${message} Backup: ${backupPath}`);
    return true;
  }

  private _startWatchingDisk(): void {
    if (this._fileWatcher || this._pollInterval) {
      return;
    }

    // Watch the directory, not the file: atomic saves replace the file (new
    // inode), which silently kills a file-level fs.watch on macOS.
    try {
      if (!fs.existsSync(this._centralDir)) {
        fs.mkdirSync(this._centralDir, { recursive: true });
      }
      this._fileWatcher = fs.watch(this._centralDir, (_event, filename) => {
        if (!filename || filename === FileNotebookRepository.DATA_FILE_NAME) {
          this._handleDiskChange();
        }
      });
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
      if (!fs.existsSync(this._centralFilePath)) {
        return false;
      }

      const stat = fs.statSync(this._centralFilePath);
      if (stat.size === this._lastSize && stat.mtimeMs === this._lastMtime) {
        return false; // Fast path: nothing changed on disk
      }

      const file = this._readCentralFile();
      if (!file) {
        return false; // Keep the in-memory cache when the file is unreadable
      }

      this._lastMtime = stat.mtimeMs;
      this._lastSize = stat.size;

      // Compare content, not timestamps: some filesystems/writers only bump
      // mtime at second granularity, and identical content must not cause a
      // cache reload (which would clobber in-flight edits).
      const signature = FileNotebookRepository._hash(file.content);
      if (signature === this._lastSignature) {
        return false;
      }

      this._lastSignature = signature;
      this._populateCache(file.data);
      return true;
    } catch (err) {
      console.error('Failed to sync Notepad Code data from central disk:', err);
      return false;
    }
  }

  private async _createDefaultStarterData(): Promise<void> {
    this._cache.clear();

    const starterNotebook = Notebook.create(
      'Notepad Code',
      'Welcome to Notepad Code'
    );

    const welcomePage = Page.create(
      starterNotebook.id,
      'Getting Started Guide',
      `Welcome to Notepad Code!

Notepad Code is your professional developer notepad, accessible across all workspaces and seamlessly styled for your editor theme.

Key Features:
• Universal Storage: All your notes remain in one centralized location across projects.
• Notebook & Page Structure: Organize your work into notebooks and pages from the left sidebar explorer.
• Full Editor Tab: Enjoy distraction-free writing in a dedicated editor tab.
• Auto-Save: Changes are saved instantly and continuously as you type.
• Real-time Live Search: Instantly filter across all notebooks and pages using the search bar.

Tips:
• Use the top action buttons to create new notebooks and pages.
• Pin important notes to keep them at the top of your list.`
    );

    const snippetPage = Page.create(
      starterNotebook.id,
      'Ideas & Scratchpad',
      `Project Ideas & Reminders

Use this space for daily scratch notes, architecture decisions, or quick TODO items:

- Keep UI clean and distraction-free
- Test newly developed features
- Keep documentation up to date`
    );

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

        // 1. Central storage (~/.notepad-code/) — written atomically so a crash
        //    mid-write can never leave a half-written (corrupt) file behind.
        if (this._storageUnsafe) {
          console.error('[NotepadCode] Skipping central data write: the existing file could not be read.');
        } else {
          try {
            if (!fs.existsSync(this._centralDir)) {
              fs.mkdirSync(this._centralDir, { recursive: true });
            }
            const tmpPath = `${this._centralFilePath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, json, 'utf8');
            fs.renameSync(tmpPath, this._centralFilePath);
            this._rememberFileSignature(json);
          } catch (e) {
            console.error('Failed to write central notepad data:', e);
          }
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
