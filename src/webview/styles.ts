import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads the shared webview stylesheet.
 *
 * The build copies the stylesheet into `dist/webview/` so a packaged extension
 * never has to ship — or read from — the TypeScript sources. The source path is
 * kept as a fallback so the very first run after a fresh clone still renders
 * correctly before `npm run compile` has been executed.
 */
export function loadStyles(extensionUri: vscode.Uri): string {
  const candidates = [
    path.join(extensionUri.fsPath, 'dist', 'webview', 'monochrome.css'),
    path.join(extensionUri.fsPath, 'src', 'webview', 'styles', 'monochrome.css'),
  ];

  const cssPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!cssPath) {
    console.error(`monochrome.css not found. Looked in: ${candidates.join(', ')}`);
    return '';
  }

  try {
    return fs.readFileSync(cssPath, 'utf8');
  } catch (err) {
    console.error('Failed to read monochrome.css:', err);
    return '';
  }
}
