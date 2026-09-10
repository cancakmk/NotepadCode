import { Page } from './Page';
import { INotebookDTO, IPageDTO } from './types';

/**
 * Domain entity representing a Notebook containing multiple Pages.
 * Encapsulates the collection of pages and notebook lifecycle.
 */
export class Notebook {
  private _id: string;
  private _title: string;
  private _description: string;
  private _createdAt: number;
  private _updatedAt: number;
  private _pages: Map<string, Page>;

  constructor(
    id: string,
    title: string,
    description: string = '',
    createdAt: number = Date.now(),
    updatedAt: number = Date.now(),
    pages: Page[] = []
  ) {
    if (!id || id.trim().length === 0) {
      throw new Error('Notebook ID cannot be empty');
    }

    this._id = id;
    this._title = title.trim() || 'Untitled Notebook';
    this._description = description.trim();
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._pages = new Map<string, Page>();

    for (const page of pages) {
      this._pages.set(page.id, page);
    }
  }

  // Getters
  public get id(): string {
    return this._id;
  }

  public get title(): string {
    return this._title;
  }

  public get description(): string {
    return this._description;
  }

  public get createdAt(): number {
    return this._createdAt;
  }

  public get updatedAt(): number {
    return this._updatedAt;
  }

  public get pageCount(): number {
    return this._pages.size;
  }

  // Domain behavior
  public updateTitle(newTitle: string): void {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      throw new Error('Notebook title cannot be empty');
    }
    if (this._title !== trimmed) {
      this._title = trimmed;
      this._touch();
    }
  }

  public updateDescription(newDescription: string): void {
    const trimmed = newDescription.trim();
    if (this._description !== trimmed) {
      this._description = trimmed;
      this._touch();
    }
  }

  public addPage(page: Page): void {
    if (page.notebookId !== this._id) {
      throw new Error(`Cannot add page: Page belongs to notebook ${page.notebookId}, but this is ${this._id}`);
    }
    if (!this._pages.has(page.id)) {
      // Prepend new page to the top
      const newMap = new Map<string, Page>();
      newMap.set(page.id, page);
      for (const [id, p] of this._pages) {
        newMap.set(id, p);
      }
      this._pages = newMap;
    } else {
      this._pages.set(page.id, page);
    }
    this._touch();
  }

  public reorderPages(orderedPageIds: string[]): void {
    const newMap = new Map<string, Page>();
    for (const id of orderedPageIds) {
      const page = this._pages.get(id);
      if (page) {
        newMap.set(id, page);
      }
    }
    for (const [id, p] of this._pages) {
      if (!newMap.has(id)) {
        newMap.set(id, p);
      }
    }
    this._pages = newMap;
    this._touch();
  }

  public removePage(pageId: string): boolean {
    const existed = this._pages.delete(pageId);
    if (existed) {
      this._touch();
    }
    return existed;
  }

  public findPage(pageId: string): Page | undefined {
    return this._pages.get(pageId);
  }

  public hasPage(pageId: string): boolean {
    return this._pages.has(pageId);
  }

  public getPages(): Page[] {
    return Array.from(this._pages.values());
  }

  private _touch(): void {
    this._updatedAt = Date.now();
  }

  public toJSON(): INotebookDTO {
    return {
      id: this._id,
      title: this._title,
      description: this._description,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      pages: this.getPages().map((p) => p.toJSON()),
    };
  }

  public static fromJSON(dto: INotebookDTO): Notebook {
    const pages = (dto.pages || []).map((pageDto: IPageDTO) => Page.fromJSON(pageDto));
    return new Notebook(
      dto.id,
      dto.title,
      dto.description || '',
      dto.createdAt ?? Date.now(),
      dto.updatedAt ?? Date.now(),
      pages
    );
  }

  public static create(title: string, description: string = ''): Notebook {
    const id = 'nb_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    return new Notebook(id, title, description, Date.now(), Date.now(), []);
  }
}
