import { IPageDTO } from './types';

/**
 * Domain entity representing an individual page in a notebook.
 * Encapsulates page state, validations, and metrics.
 */
export class Page {
  private _id: string;
  private _notebookId: string;
  private _title: string;
  private _content: string;
  private _isPinned: boolean;
  private _createdAt: number;
  private _updatedAt: number;

  constructor(
    id: string,
    notebookId: string,
    title: string,
    content: string = '',
    isPinned: boolean = false,
    createdAt: number = Date.now(),
    updatedAt: number = Date.now()
  ) {
    if (!id || id.trim().length === 0) {
      throw new Error('Page ID cannot be empty');
    }
    if (!notebookId || notebookId.trim().length === 0) {
      throw new Error('Notebook ID cannot be empty');
    }

    this._id = id;
    this._notebookId = notebookId;
    this._title = title.trim() || 'Untitled Page';
    this._content = content;
    this._isPinned = isPinned;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  // Getters
  public get id(): string {
    return this._id;
  }

  public get notebookId(): string {
    return this._notebookId;
  }

  public get title(): string {
    return this._title;
  }

  public get content(): string {
    return this._content;
  }

  public get isPinned(): boolean {
    return this._isPinned;
  }

  public get createdAt(): number {
    return this._createdAt;
  }

  public get updatedAt(): number {
    return this._updatedAt;
  }

  // Domain behavior
  public updateTitle(newTitle: string): void {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      throw new Error('Page title cannot be empty');
    }
    if (this._title !== trimmed) {
      this._title = trimmed;
      this._touch();
    }
  }

  public updateContent(newContent: string): void {
    if (this._content !== newContent) {
      this._content = newContent;
      this._touch();
    }
  }

  public togglePin(): boolean {
    this._isPinned = !this._isPinned;
    this._touch();
    return this._isPinned;
  }

  public setPinned(pinned: boolean): void {
    if (this._isPinned !== pinned) {
      this._isPinned = pinned;
      this._touch();
    }
  }

  public getWordCount(): number {
    const text = this._content.trim();
    if (!text) {
      return 0;
    }
    return text.split(/\s+/).filter(Boolean).length;
  }

  public getCharacterCount(): number {
    return this._content.length;
  }

  public getEstimatedReadingTimeMinutes(): number {
    const words = this.getWordCount();
    return Math.max(1, Math.ceil(words / 200));
  }

  private _touch(): void {
    this._updatedAt = Date.now();
  }

  public toJSON(): IPageDTO {
    return {
      id: this._id,
      notebookId: this._notebookId,
      title: this._title,
      content: this._content,
      isPinned: this._isPinned,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }

  public static fromJSON(dto: IPageDTO): Page {
    return new Page(
      dto.id,
      dto.notebookId,
      dto.title,
      dto.content ?? '',
      dto.isPinned ?? false,
      dto.createdAt ?? Date.now(),
      dto.updatedAt ?? Date.now()
    );
  }

  public static create(notebookId: string, title: string, content: string = ''): Page {
    const id = 'page_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    return new Page(id, notebookId, title, content, false, Date.now(), Date.now());
  }
}
