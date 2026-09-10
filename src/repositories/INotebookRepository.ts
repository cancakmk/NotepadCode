import { Notebook } from '../models/Notebook';
import { Page } from '../models/Page';
import { IStorageData } from '../models/types';

/**
 * Interface contract for Notepad persistence.
 * Follows the Repository pattern and Dependency Inversion Principle.
 */
export interface INotebookRepository {
  /**
   * Initializes the repository and ensures storage resources exist.
   */
  initialize(): Promise<void>;

  /**
   * Retrieves all notebooks.
   */
  getAllNotebooks(): Promise<Notebook[]>;

  /**
   * Retrieves a notebook by its unique ID.
   */
  getNotebookById(id: string): Promise<Notebook | undefined>;

  /**
   * Saves or updates a notebook.
   */
  saveNotebook(notebook: Notebook): Promise<void>;

  /**
   * Deletes a notebook by its unique ID.
   */
  deleteNotebook(id: string): Promise<boolean>;

  /**
   * Saves or updates a page inside its notebook.
   */
  savePage(page: Page): Promise<void>;

  /**
   * Deletes a page from its notebook.
   */
  deletePage(notebookId: string, pageId: string): Promise<boolean>;

  /**
   * Reorders notebooks based on user drag-and-drop order.
   */
  reorderNotebooks(orderedNotebookIds: string[]): Promise<void>;

  /**
   * Reorders pages within a notebook based on user drag-and-drop order.
   */
  reorderPages(notebookId: string, orderedPageIds: string[]): Promise<void>;

  /**
   * Gets the entire raw data structure (useful for exports).
   */
  getRawData(): Promise<IStorageData>;

  /**
   * Overwrites the storage with an imported data structure.
   */
  importRawData(data: IStorageData): Promise<void>;
}
