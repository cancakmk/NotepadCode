import * as vscode from 'vscode';
import { getSidebarHtml } from './getSidebarHtml';

/**
 * Backwards-compatible alias for getSidebarHtml.
 */
export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  _title: string = 'Notepad Code'
): string {
  return getSidebarHtml(webview, extensionUri);
}
