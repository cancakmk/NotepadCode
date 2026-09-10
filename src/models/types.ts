/**
 * Core type definitions for Notepad Code extension.
 */

export interface IPageDTO {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface INotebookDTO {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  pages: IPageDTO[];
}

export interface IStorageData {
  version: number;
  notebooks: INotebookDTO[];
  activeNotebookId?: string;
  activePageId?: string;
}

export interface ISearchResult {
  notebookId: string;
  notebookTitle: string;
  pageId: string;
  pageTitle: string;
  matchedSnippet: string;
  isTitleMatch: boolean;
}

export type WebviewMessageToExtension =
  | { type: 'ready' }
  | { type: 'createNotebook'; title: string; description?: string }
  | { type: 'updateNotebook'; id: string; title: string; description?: string }
  | { type: 'deleteNotebook'; id: string }
  | { type: 'createPage'; notebookId: string; title: string; content?: string }
  | { type: 'updatePage'; notebookId: string; pageId: string; title: string; content: string; isPinned?: boolean }
  | { type: 'deletePage'; notebookId: string; pageId: string }
  | { type: 'togglePinPage'; notebookId: string; pageId: string }
  | { type: 'selectPage'; notebookId: string; pageId: string }
  | { type: 'openInEditor'; notebookId: string; pageId: string }
  | { type: 'reorderNotebooks'; notebookIds: string[] }
  | { type: 'reorderPages'; notebookId: string; pageIds: string[] }
  | { type: 'movePage'; pageId: string; sourceNotebookId: string; targetNotebookId: string; targetIndex: number }
  | { type: 'exportData' }
  | { type: 'importData'; data: string };

export type ExtensionMessageToWebview =
  | { type: 'syncData'; data: IStorageData }
  | { type: 'pageSelected'; notebookId: string; pageId: string }
  | { type: 'notification'; message: string; level?: 'info' | 'warn' | 'error' };
