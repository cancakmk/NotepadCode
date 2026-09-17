import { Notebook } from '../models/Notebook';
import { Page } from '../models/Page';
import { INotebookDTO, ISearchResult, IStorageData } from '../models/types';
import { INotebookRepository } from '../repositories/INotebookRepository';
import { contentToPlainText } from '../utils/noteContent';

/**
 * Service orchestrating notebook and page business logic.
 * Follows Single Responsibility and Clean Architecture patterns.
 */
export class NotebookService {
  private readonly _repository: INotebookRepository;

  constructor(repository: INotebookRepository) {
    this._repository = repository;
  }

  public async getStorageData(): Promise<IStorageData> {
    return this._repository.getRawData();
  }

  public async getAllNotebooks(): Promise<Notebook[]> {
    return this._repository.getAllNotebooks();
  }

  public async getNotebook(id: string): Promise<Notebook | undefined> {
    return this._repository.getNotebookById(id);
  }

  public async createNotebook(title: string, description: string = ''): Promise<Notebook> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error('Notebook title cannot be empty.');
    }

    const notebook = Notebook.create(trimmedTitle, description);
    // Create an initial empty page for convenience
    const initialPage = Page.create(notebook.id, 'General', '');
    notebook.addPage(initialPage);

    await this._repository.saveNotebook(notebook);
    return notebook;
  }

  public async updateNotebook(id: string, title: string, description?: string): Promise<Notebook> {
    const notebook = await this._repository.getNotebookById(id);
    if (!notebook) {
      throw new Error(`Notebook not found: ${id}`);
    }

    notebook.updateTitle(title);
    if (description !== undefined) {
      notebook.updateDescription(description);
    }

    await this._repository.saveNotebook(notebook);
    return notebook;
  }

  public async deleteNotebook(id: string): Promise<boolean> {
    return this._repository.deleteNotebook(id);
  }

  public async createPage(notebookId: string, title: string, content: string = ''): Promise<Page> {
    const notebook = await this._repository.getNotebookById(notebookId);
    if (!notebook) {
      throw new Error(`Notebook not found: ${notebookId}`);
    }

    const page = Page.create(notebookId, title || 'Untitled Page', content);
    notebook.addPage(page);
    await this._repository.saveNotebook(notebook);
    return page;
  }

  public async updatePage(
    notebookId: string,
    pageId: string,
    title: string,
    content: string
  ): Promise<Page> {
    const notebook = await this._repository.getNotebookById(notebookId);
    if (!notebook) {
      throw new Error(`Notebook not found: ${notebookId}`);
    }

    const page = notebook.findPage(pageId);
    if (!page) {
      throw new Error(`Page not found: ${pageId}`);
    }

    page.updateTitle(title);
    page.updateContent(content);

    await this._repository.saveNotebook(notebook);
    return page;
  }

  public async reorderNotebooks(orderedNotebookIds: string[]): Promise<void> {
    return this._repository.reorderNotebooks(orderedNotebookIds);
  }

  public async reorderPages(notebookId: string, orderedPageIds: string[]): Promise<void> {
    return this._repository.reorderPages(notebookId, orderedPageIds);
  }

  public async deletePage(notebookId: string, pageId: string): Promise<boolean> {
    return this._repository.deletePage(notebookId, pageId);
  }

  /**
   * Performs full-text search across all notebooks and their pages.
   */
  public async search(query: string): Promise<ISearchResult[]> {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return [];
    }

    const notebooks = await this._repository.getAllNotebooks();
    const results: ISearchResult[] = [];

    for (const notebook of notebooks) {
      for (const page of notebook.getPages()) {
        const plainContent = contentToPlainText(page.content);
        const titleMatch = page.title.toLowerCase().includes(normalizedQuery);
        const contentMatch = plainContent.toLowerCase().includes(normalizedQuery);

        if (titleMatch || contentMatch) {
          let snippet = '';
          if (contentMatch) {
            const idx = plainContent.toLowerCase().indexOf(normalizedQuery);
            const start = Math.max(0, idx - 40);
            const end = Math.min(plainContent.length, idx + normalizedQuery.length + 40);
            snippet = (start > 0 ? '...' : '') + plainContent.substring(start, end).replace(/\n/g, ' ') + (end < plainContent.length ? '...' : '');
          } else {
            snippet = plainContent.substring(0, 80).replace(/\n/g, ' ') || 'No content';
          }

          results.push({
            notebookId: notebook.id,
            notebookTitle: notebook.title,
            pageId: page.id,
            pageTitle: page.title,
            matchedSnippet: snippet,
            isTitleMatch: titleMatch,
          });
        }
      }
    }

    return results;
  }
}
