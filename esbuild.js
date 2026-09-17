const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copies the KaTeX stylesheet and web fonts, plus the extension stylesheet,
 * into dist/webview so the packaged extension never reads from node_modules or
 * the TypeScript sources at runtime (the webview CSP also blocks CDNs).
 *
 * Only the woff2 fonts are copied: every VS Code webview runs on a Chromium
 * that has supported woff2 for years, and the .woff/.ttf fallbacks would add
 * roughly 900 KB to the package for no benefit.
 */
function copyWebviewAssets() {
  const target = path.join(__dirname, 'dist', 'webview');
  const fontTarget = path.join(target, 'fonts');
  fs.mkdirSync(fontTarget, { recursive: true });

  // 1. Extension stylesheet
  const stylesheet = path.join(__dirname, 'src', 'webview', 'styles', 'monochrome.css');
  if (fs.existsSync(stylesheet)) {
    fs.copyFileSync(stylesheet, path.join(target, 'monochrome.css'));
  } else {
    console.warn('[build] monochrome.css not found, webviews will render unstyled');
  }

  // 2. KaTeX stylesheet + fonts
  const katexDist = path.join(__dirname, 'node_modules', 'katex', 'dist');
  if (!fs.existsSync(katexDist)) {
    console.warn('[build] katex not found, math will render with system fonts');
    return;
  }

  const katexCss = path.join(katexDist, 'katex.min.css');
  if (fs.existsSync(katexCss)) {
    fs.copyFileSync(katexCss, path.join(target, 'katex.min.css'));
  }

  const fonts = path.join(katexDist, 'fonts');
  if (!fs.existsSync(fonts)) {
    console.warn('[build] katex fonts not found');
    return;
  }

  for (const file of fs.readdirSync(fonts)) {
    if (file.endsWith('.woff2')) {
      fs.copyFileSync(path.join(fonts, file), path.join(fontTarget, file));
    }
  }
}

/** Extension host bundle (Node, CommonJS, vscode is external). */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'info',
};

/** Webview bundle (browser, IIFE) — the Tiptap rich text editor. */
const webviewConfig = {
  entryPoints: ['src/webview/editor/main.ts'],
  bundle: true,
  format: 'iife',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview/editor.js',
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  logLevel: 'info',
};

async function main() {
  copyWebviewAssets();

  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes...');
    return;
  }

  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
