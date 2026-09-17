/**
 * Notepad Code — Rich Text Editor Webview Script
 *
 * A Notion-like editing experience built on Tiptap:
 *  - slash (/) command menu for inserting blocks (text, headings, lists, to-dos,
 *    toggle, table, quote, code, divider, image, emoji, math)
 *  - floating toolbar on text selection (marks, alignment, turn into)
 *  - table toolbar (add/remove rows and columns, merge, header)
 *  - emoji picker and text styling popover (font, size, colour, highlight)
 *  - syntax-highlighted code blocks and KaTeX math
 *  - markdown-style input rules ("# ", "- ", "1. ", "> ", "```", "[] ")
 *  - focus mode, invisible characters, debounced auto-save
 *
 * Runs inside the editor webview; communicates with the extension host through
 * the standard postMessage protocol (ready / syncData / pageSelected / pageCleared
 * in, updatePage / deletePage out).
 */

import { Editor, Extension } from '@tiptap/core';
import type { ChainedCommands } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Focus, Placeholder } from '@tiptap/extensions';
import { Table, TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Highlight } from '@tiptap/extension-highlight';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TextAlign } from '@tiptap/extension-text-align';
import { Typography } from '@tiptap/extension-typography';
import { InvisibleCharacters } from '@tiptap/extension-invisible-characters';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Mathematics } from '@tiptap/extension-mathematics';
import { common, createLowlight } from 'lowlight';
import { contentToHtml } from '../../utils/noteContent';
import { Icons } from '../icons';

// ---------------------------------------------------------------------------
// VS Code webview API
// ---------------------------------------------------------------------------
interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Table extensions (extended with the styling attributes the toolbar drives)
// ---------------------------------------------------------------------------

/**
 * Table-level presentation flags. Stored as data attributes so a plain text
 * exporter or an AI reader never trips over presentational markup.
 */
const ExtendedTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      striped: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-striped') === 'true',
        renderHTML: (attributes) => (attributes.striped ? { 'data-striped': 'true' } : {}),
      },
      compact: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-compact') === 'true',
        renderHTML: (attributes) => (attributes.compact ? { 'data-compact': 'true' } : {}),
      },
      fitContent: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-fit') === 'true',
        renderHTML: (attributes) => (attributes.fitContent ? { 'data-fit': 'true' } : {}),
      },
    };
  },
});

/** Cell background colour, shared by body cells and header cells. */
const cellBackgroundAttribute = {
  backgroundColor: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-background-color'),
    renderHTML: (attributes: Record<string, any>) =>
      attributes.backgroundColor
        ? {
            'data-background-color': attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`,
          }
        : {},
  },
};

const ExtendedTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackgroundAttribute };
  },
});

const ExtendedTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackgroundAttribute };
  },
});

/**
 * Presentation flags stored on the table node and mirrored to the DOM.
 * Node attribute -> rendered data attribute.
 */
const TABLE_FLAGS: Array<[string, string]> = [
  ['striped', 'data-striped'],
  ['compact', 'data-compact'],
  ['fitContent', 'data-fit'],
];

/**
 * Mirrors the table presentation flags onto the rendered `<table>` elements.
 *
 * A resizable table is rendered by Tiptap's own node view, whose `update()` only
 * refreshes column widths — it never writes node attributes to the element, so
 * without this the CSS hooks (striped rows, compact cells, fit width) would have
 * no effect. Safe to call at any time; it only touches attributes.
 */
function syncTableDom(view: EditorView = editor.view): void {
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') {
      return true;
    }

    const dom = view.nodeDOM(pos);
    const element =
      dom instanceof HTMLElement
        ? dom.tagName === 'TABLE'
          ? dom
          : dom.querySelector('table')
        : null;

    if (element) {
      for (const [attribute, domAttribute] of TABLE_FLAGS) {
        if (node.attrs[attribute]) {
          element.setAttribute(domAttribute, 'true');
        } else {
          element.removeAttribute(domAttribute);
        }
      }
    }

    return false; // tables cannot be nested
  });
}

/**
 * Keeps the DOM in step with the table flags after every document change. The
 * sync is deferred by a microtask so it runs once the view has finished its own
 * DOM work for the transaction.
 */
const TableDomSync = Extension.create({
  name: 'tableDomSync',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableDomSync'),
        view: (view) => ({
          update: () => {
            queueMicrotask(() => syncTableDom(editor.view));
          },
        }),
      }),
    ];
  },
});

/** Background palette offered by the table toolbar. */
const CELL_COLORS: Array<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: 'Grey', value: 'rgba(128, 128, 128, 0.16)' },
  { label: 'Blue', value: 'rgba(0, 145, 255, 0.16)' },
  { label: 'Green', value: 'rgba(48, 164, 108, 0.18)' },
  { label: 'Yellow', value: 'rgba(255, 178, 36, 0.20)' },
  { label: 'Red', value: 'rgba(229, 72, 77, 0.16)' },
  { label: 'Purple', value: 'rgba(142, 78, 198, 0.16)' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface IPage {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  updatedAt: number;
}
interface INotebook {
  id: string;
  title: string;
  pages: IPage[];
}
interface IStorageData {
  notebooks: INotebook[];
}

interface PendingSave {
  notebookId: string | null;
  pageId: string | null;
  title: string;
  content: string;
}

interface BlockItem {
  id: string;
  title: string;
  hint: string;
  glyph: string;
  keywords: string;
  run: () => void;
}

interface SlashContext {
  from: number;
  to: number;
  query: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  data: { notebooks: [] } as IStorageData,
  activeNotebookId: null as string | null,
  activePageId: null as string | null,
  saveTimeout: null as ReturnType<typeof setTimeout> | null,
  pendingSave: null as PendingSave | null,
  lastAppliedContent: null as string | null,
};

let isApplyingRemote = false;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const elements = {
  title: document.getElementById('note-title') as HTMLInputElement,
  body: document.getElementById('note-body') as HTMLElement,
  stats: document.getElementById('note-stats') as HTMLElement,
  saveCircle: document.getElementById('save-circle') as HTMLElement,
  saveText: document.getElementById('save-text') as HTMLElement,
  btnCopy: document.getElementById('btn-copy') as HTMLButtonElement,
  btnDelete: document.getElementById('btn-delete') as HTMLButtonElement,
  btnFocus: document.getElementById('btn-focus') as HTMLButtonElement,
  btnInvisible: document.getElementById('btn-invisible') as HTMLButtonElement,
  bubble: document.getElementById('bubble-menu') as HTMLElement,
  tableMenu: document.getElementById('table-menu') as HTMLElement,
  codeMenu: document.getElementById('code-menu') as HTMLElement,
  codeLangButton: document.getElementById('code-lang-button') as HTMLButtonElement,
  codeLangLabel: document.getElementById('code-lang-label') as HTMLElement,
  codeLangPicker: document.getElementById('code-lang-picker') as HTMLElement,
  slash: document.getElementById('slash-menu') as HTMLElement,
  emoji: document.getElementById('emoji-picker') as HTMLElement,
  stylePicker: document.getElementById('style-picker') as HTMLElement,
  dialog: document.getElementById('input-dialog') as HTMLElement,
  dialogTitle: document.getElementById('input-dialog-title') as HTMLElement,
  dialogField: document.getElementById('input-dialog-field') as HTMLInputElement,
  dialogHint: document.getElementById('input-dialog-hint') as HTMLElement,
  dialogCancel: document.getElementById('input-dialog-cancel') as HTMLButtonElement,
  dialogSubmit: document.getElementById('input-dialog-submit') as HTMLButtonElement,
};

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
const lowlight = createLowlight(common);

const editor = new Editor({
  element: elements.body,
  editable: false,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      trailingNode: {},
      // Replaced by the syntax-highlighted code block below
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // The kit's table nodes are disabled in favour of the extended versions
    TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
    ExtendedTable.configure({ resizable: true, handleWidth: 6 }),
    ExtendedTableCell,
    ExtendedTableHeader,
    TableDomSync,
    Image.configure({ allowBase64: true, inline: false }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'np-details' } }),
    DetailsSummary,
    DetailsContent,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Typography,
    CharacterCount,
    Focus.configure({ className: 'np-focused', mode: 'deepest' }),
    InvisibleCharacters.configure({ visible: false }),
    Placeholder.configure({ placeholder: 'Type "/" for commands…' }),
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
  ],
  editorProps: {
    attributes: {
      class: 'np-prose',
      spellcheck: 'false',
    },
  },
  content: '',
  onUpdate: () => {
    if (isApplyingRemote) {
      return;
    }
    onContentChange();
  },
  onSelectionUpdate: () => {
    updateSlashMenu();
    updateBubbleMenu();
    updateTableMenu();
    updateCodeMenu();
  },
  onBlur: () => {
    hideSlashMenu();
    hideBubbleMenu();
    hideTableMenu();
    hideCodeMenu();
  },
});

/** Loose typing for extension commands the chain type does not know about. */
type AnyChain = ChainedCommands & Record<string, (...args: any[]) => any>;

function chain(): AnyChain {
  return editor.chain().focus() as unknown as AnyChain;
}

// ---------------------------------------------------------------------------
// Input dialog
// ---------------------------------------------------------------------------
interface DialogOptions {
  title: string;
  placeholder?: string;
  value?: string;
  hint?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
}

let activeDialog: DialogOptions | null = null;

function showDialog(options: DialogOptions): void {
  activeDialog = options;
  elements.dialogTitle.innerText = options.title;
  elements.dialogField.placeholder = options.placeholder ?? '';
  elements.dialogField.value = options.value ?? '';
  elements.dialogHint.innerText = options.hint ?? '';
  elements.dialogSubmit.innerText = options.submitLabel ?? 'Insert';
  elements.dialog.classList.add('open');

  setTimeout(() => {
    elements.dialogField.focus();
    elements.dialogField.select();
  }, 30);
}

function closeDialog(): void {
  activeDialog = null;
  elements.dialog.classList.remove('open');
  elements.dialogField.value = '';
}

function submitDialog(): void {
  const options = activeDialog;
  const value = elements.dialogField.value;
  if (!options) {
    return;
  }
  closeDialog();
  options.onSubmit(value);
  editor.commands.focus();
}

elements.dialogCancel.addEventListener('click', () => {
  closeDialog();
  editor.commands.focus();
});

elements.dialogSubmit.addEventListener('click', submitDialog);

elements.dialogField.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitDialog();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog();
    editor.commands.focus();
  }
});

elements.dialog.addEventListener('mousedown', (event) => {
  if (event.target === elements.dialog) {
    closeDialog();
    editor.commands.focus();
  }
});

// ---------------------------------------------------------------------------
// Emoji picker
// ---------------------------------------------------------------------------
const EMOJI_GROUPS: Array<{ name: string; emojis: string[] }> = [
  {
    name: 'Frequent',
    emojis: ['✅', '❌', '⚠️', '💡', '📌', '⭐', '🔥', '🎯', '🚀', '🐛', '📝', '📅'],
  },
  {
    name: 'Smileys',
    emojis: ['😀', '😄', '😉', '😍', '🤔', '😐', '😴', '😢', '😡', '🤯', '🥳', '🤝'],
  },
  {
    name: 'Objects',
    emojis: ['📁', '📂', '🔖', '📎', '🔗', '🔒', '🔑', '⚙️', '🧪', '🧩', '🛠️', '📊'],
  },
  {
    name: 'Symbols',
    emojis: ['➡️', '⬅️', '⬆️', '⬇️', '✔️', '➕', '➖', '❓', '❗', '💬', '♻️', '⏱️'],
  },
];

function buildEmojiPicker(): void {
  elements.emoji.innerHTML = `
    <div class="popover-header">Emoji</div>
    ${EMOJI_GROUPS.map(
      (group) => `
      <div class="emoji-group">
        <div class="emoji-group-name">${group.name}</div>
        <div class="emoji-grid">
          ${group.emojis
            .map((emoji) => `<button class="emoji-button" data-emoji="${emoji}">${emoji}</button>`)
            .join('')}
        </div>
      </div>`
    ).join('')}
  `;
}

elements.emoji.addEventListener('mousedown', (event) => event.preventDefault());

elements.emoji.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-emoji]') as HTMLElement | null;
  if (!button) {
    return;
  }
  chain().insertContent(button.dataset.emoji ?? '').run();
  hidePopover(elements.emoji);
});

function openEmojiPicker(): void {
  const { from } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);
  positionPopover(elements.emoji, { left: coords.left, top: coords.top, bottom: coords.bottom });
}

// ---------------------------------------------------------------------------
// Text styling popover
// ---------------------------------------------------------------------------
const FONT_FAMILIES: Array<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { label: 'Rounded', value: 'ui-rounded, "SF Pro Rounded", "Segoe UI", sans-serif' },
];

const FONT_SIZES: Array<{ label: string; value: string }> = [
  { label: 'S', value: '13px' },
  { label: 'M', value: '15px' },
  { label: 'L', value: '18px' },
  { label: 'XL', value: '22px' },
];

const LINE_HEIGHTS: Array<{ label: string; value: string }> = [
  { label: '1', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2', value: '2' },
];

const TEXT_COLORS = ['#e5484d', '#f76808', '#ffb224', '#30a46c', '#0091ff', '#8e4ec6', '#e93d82', '#8b8b8b'];
const HIGHLIGHT_COLORS = ['#fff3bf', '#ffd8a8', '#b2f2bb', '#a5d8ff', '#d0bfff', '#ffc9c9', '#e9ecef'];
const BACKGROUND_COLORS = ['#fff9db', '#e7f5ff', '#ebfbee', '#fff0f6', '#f3f0ff', '#f8f9fa'];

function buildStylePicker(): void {
  elements.stylePicker.innerHTML = `
    <div class="popover-header">Format</div>

    <div class="style-section">
      <div class="style-label">Font</div>
      <div class="style-chips">
        ${FONT_FAMILIES.map(
          (item, index) =>
            `<button class="style-chip" data-font="${index}">${item.label}</button>`
        ).join('')}
      </div>
    </div>

    <div class="style-section">
      <div class="style-label">Size</div>
      <div class="style-chips">
        ${FONT_SIZES.map((item) => `<button class="style-chip" data-size="${item.value}">${item.label}</button>`).join('')}
        <button class="style-chip" data-size="reset">Reset</button>
      </div>
    </div>

    <div class="style-section">
      <div class="style-label">Line height</div>
      <div class="style-chips">
        ${LINE_HEIGHTS.map((item) => `<button class="style-chip" data-line="${item.value}">${item.label}</button>`).join('')}
      </div>
    </div>

    <div class="style-section">
      <div class="style-label">Text colour</div>
      <div class="swatch-row">
        ${TEXT_COLORS.map((color) => `<button class="swatch" data-color="${color}" style="background:${color};"></button>`).join('')}
        <button class="swatch swatch-reset" data-color="reset" title="Default colour">A</button>
      </div>
    </div>

    <div class="style-section">
      <div class="style-label">Highlight</div>
      <div class="swatch-row">
        ${HIGHLIGHT_COLORS.map((color) => `<button class="swatch" data-highlight="${color}" style="background:${color};"></button>`).join('')}
        <button class="swatch swatch-reset" data-highlight="reset" title="No highlight">&#10005;</button>
      </div>
    </div>

    <div class="style-section">
      <div class="style-label">Background</div>
      <div class="swatch-row">
        ${BACKGROUND_COLORS.map((color) => `<button class="swatch" data-bg="${color}" style="background:${color};"></button>`).join('')}
        <button class="swatch swatch-reset" data-bg="reset" title="No background">&#10005;</button>
      </div>
    </div>
  `;
}

elements.stylePicker.addEventListener('mousedown', (event) => event.preventDefault());

elements.stylePicker.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!button) {
    return;
  }

  const c = chain();
  const { font, size, line, color, highlight, bg } = button.dataset;

  if (font !== undefined) {
    const family = FONT_FAMILIES[Number(font)];
    if (family?.value) {
      c.setFontFamily(family.value).run();
    } else {
      c.unsetFontFamily().run();
    }
  } else if (size !== undefined) {
    if (size === 'reset') {
      c.unsetFontSize().run();
    } else {
      c.setFontSize(size).run();
    }
  } else if (line !== undefined) {
    c.setLineHeight(line).run();
  } else if (color !== undefined) {
    if (color === 'reset') {
      c.unsetColor().run();
    } else {
      c.setColor(color).run();
    }
  } else if (highlight !== undefined) {
    if (highlight === 'reset') {
      c.unsetHighlight().run();
    } else {
      c.setHighlight({ color: highlight }).run();
    }
  } else if (bg !== undefined) {
    if (bg === 'reset') {
      c.unsetBackgroundColor().run();
    } else {
      c.setBackgroundColor(bg).run();
    }
  }

  updateBubbleMenu();
});

// ---------------------------------------------------------------------------
// Popover helpers
// ---------------------------------------------------------------------------
function hidePopover(element: HTMLElement): void {
  element.classList.remove('open');
}

function hideAllPopovers(): void {
  hidePopover(elements.emoji);
  hidePopover(elements.stylePicker);
  hidePopover(elements.codeLangPicker);
}

function positionPopover(element: HTMLElement, anchor: { left: number; top: number; bottom: number }): void {
  element.classList.add('open');

  const rect = element.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8));

  let top = anchor.bottom + 6;
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, anchor.top - rect.height - 6);
  }

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

// ---------------------------------------------------------------------------
// Insert dialogs (table, image, math, link)
// ---------------------------------------------------------------------------
function insertTable(): void {
  showDialog({
    title: 'Insert table',
    placeholder: '3x3',
    value: '3x3',
    hint: 'Rows x Columns (e.g. 3x3)',
    onSubmit: (value) => {
      const match = /^\s*(\d+)\s*[x×,\s]\s*(\d+)\s*$/i.exec(value);
      const rows = match ? Math.min(20, Math.max(1, Number(match[1]))) : 3;
      const cols = match ? Math.min(12, Math.max(1, Number(match[2]))) : 3;
      chain().insertTable({ rows, cols, withHeaderRow: true }).run();
    },
  });
}

function insertImage(): void {
  showDialog({
    title: 'Insert image',
    placeholder: 'https://…',
    hint: 'Paste an image URL, or leave empty to choose a local file',
    onSubmit: (value) => {
      const url = value.trim();
      if (url) {
        chain().setImage({ src: url, alt: '' }).run();
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const src = String(reader.result ?? '');
          if (src) {
            chain().setImage({ src, alt: file.name }).run();
          }
        };
        reader.readAsDataURL(file);
      });
      input.click();
    },
  });
}

function insertMath(inline: boolean): void {
  showDialog({
    title: inline ? 'Inline math' : 'Math block',
    placeholder: 'E = mc^2',
    hint: 'LaTeX expression',
    onSubmit: (value) => {
      const latex = value.trim();
      if (!latex) {
        return;
      }
      if (inline) {
        chain().insertInlineMath({ latex }).run();
      } else {
        chain().insertBlockMath({ latex }).run();
      }
    },
  });
}

function insertLink(): void {
  const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
  showDialog({
    title: previous ? 'Edit link' : 'Add link',
    placeholder: 'https://…',
    value: previous,
    hint: 'Leave empty to remove the link',
    submitLabel: 'Apply',
    onSubmit: (value) => {
      const url = value.trim();
      const linkChain = editor.chain().focus().extendMarkRange('link') as unknown as AnyChain;
      if (!url) {
        linkChain.unsetLink().run();
      } else {
        linkChain.setLink({ href: url }).run();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Slash command menu
// ---------------------------------------------------------------------------
const BLOCK_ITEMS: BlockItem[] = [
  {
    id: 'text',
    title: 'Text',
    hint: 'Plain paragraph',
    glyph: 'T',
    keywords: 'text paragraph plain body',
    run: () => chain().setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    hint: 'Large section title',
    glyph: 'H1',
    keywords: 'heading h1 title large',
    run: () => chain().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: 'Medium section title',
    glyph: 'H2',
    keywords: 'heading h2 title medium',
    run: () => chain().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: 'Small section title',
    glyph: 'H3',
    keywords: 'heading h3 title small',
    run: () => chain().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'h4',
    title: 'Heading 4',
    hint: 'Smallest section title',
    glyph: 'H4',
    keywords: 'heading h4 title tiny',
    run: () => chain().toggleHeading({ level: 4 }).run(),
  },
  {
    id: 'bullets',
    title: 'Bulleted list',
    hint: 'Simple unordered list',
    glyph: '•',
    keywords: 'bullet list unordered ul',
    run: () => chain().toggleBulletList().run(),
  },
  {
    id: 'numbers',
    title: 'Numbered list',
    hint: 'Ordered list with numbers',
    glyph: '1.',
    keywords: 'numbered ordered list ol',
    run: () => chain().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    hint: 'Checklist with checkboxes',
    glyph: '☑',
    keywords: 'todo task checkbox check list',
    run: () => chain().toggleTaskList().run(),
  },
  {
    id: 'toggle',
    title: 'Toggle list',
    hint: 'Collapsible section',
    glyph: '▸',
    keywords: 'toggle details collapse fold expand summary',
    run: () => chain().setDetails().run(),
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'Rows and columns',
    glyph: '▦',
    keywords: 'table grid rows columns spreadsheet',
    run: insertTable,
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: 'Capture a quotation',
    glyph: '❝',
    keywords: 'quote blockquote citation',
    run: () => chain().toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    hint: 'Syntax highlighted snippet',
    glyph: '</>',
    keywords: 'code block snippet monospace pre highlight',
    run: () => chain().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: 'Visual separator',
    glyph: '—',
    keywords: 'divider separator horizontal rule hr line',
    run: () => chain().setHorizontalRule().run(),
  },
  {
    id: 'image',
    title: 'Image',
    hint: 'Upload or link an image',
    glyph: '🖼',
    keywords: 'image picture photo upload attachment media',
    run: insertImage,
  },
  {
    id: 'emoji',
    title: 'Emoji',
    hint: 'Insert an emoji',
    glyph: '😀',
    keywords: 'emoji emoticon smiley icon',
    run: openEmojiPicker,
  },
  {
    id: 'math-inline',
    title: 'Inline math',
    hint: 'Formula inside a line of text',
    glyph: '∑',
    keywords: 'math inline formula latex equation katex',
    run: () => insertMath(true),
  },
  {
    id: 'math-block',
    title: 'Math block',
    hint: 'Centered display formula',
    glyph: '∫',
    keywords: 'math block formula latex equation katex display',
    run: () => insertMath(false),
  },
  {
    id: 'link',
    title: 'Link',
    hint: 'Link the selected text',
    glyph: '🔗',
    keywords: 'link url href anchor',
    run: insertLink,
  },
];

let slashContext: SlashContext | null = null;
let slashItems: BlockItem[] = [];
let slashIndex = 0;
/** Identifies the currently rendered item set, so the list is not rebuilt needlessly. */
let slashSignature = '';

function getSlashContext(): SlashContext | null {
  if (!editor.isEditable) {
    return null;
  }

  const { from, $from } = editor.state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') {
    return null;
  }

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(textBefore);
  if (!match) {
    return null;
  }

  const query = match[1];
  return { from: from - query.length - 1, to: from, query };
}

function updateSlashMenu(): void {
  const context = getSlashContext();
  if (!context) {
    hideSlashMenu();
    return;
  }

  const query = context.query.toLowerCase();
  const items = BLOCK_ITEMS.filter(
    (item) =>
      !query ||
      item.keywords.includes(query) ||
      item.title.toLowerCase().includes(query)
  );

  if (items.length === 0) {
    hideSlashMenu();
    return;
  }

  slashContext = context;

  // Only rebuild the list when the filtered set actually changes. Rebuilding on
  // every selection update would reset the menu's scroll position, which made
  // the highlight walk off the bottom of the list while the list stayed put.
  const signature = items.map((item) => item.id).join(',');
  if (signature !== slashSignature) {
    const wasEmpty = slashItems.length === 0;
    slashSignature = signature;
    slashItems = items;

    if (wasEmpty || slashIndex >= items.length) {
      slashIndex = 0;
    }

    renderSlashMenu();
  }

  updateSlashHighlight();
  positionSlashMenu();
  elements.slash.classList.add('open');
}

function renderSlashMenu(): void {
  elements.slash.innerHTML = slashItems
    .map(
      (item, index) => `
      <button class="slash-item" data-index="${index}">
        <span class="slash-glyph">${item.glyph}</span>
        <span class="slash-texts">
          <span class="slash-title">${item.title}</span>
          <span class="slash-hint">${item.hint}</span>
        </span>
      </button>`
    )
    .join('');

  elements.slash.scrollTop = 0;
}

/** Moves the highlight without touching the DOM structure or the scroll offset. */
function updateSlashHighlight(): void {
  const buttons = elements.slash.querySelectorAll('.slash-item');
  let active: HTMLElement | null = null;

  buttons.forEach((button, index) => {
    const isActive = index === slashIndex;
    button.classList.toggle('active', isActive);
    if (isActive) {
      active = button as HTMLElement;
    }
  });

  if (active) {
    scrollSlashItemIntoView(active);
  }
}

/**
 * Scrolls the menu just enough to keep the highlighted row visible.
 *
 * Measured with `offsetTop`/`offsetHeight` rather than `getBoundingClientRect()`:
 * those are laid out relative to the menu's padding edge, exactly like
 * `scrollTop`, so the menu's border and padding cannot skew the result.
 * The first and last rows snap to the very ends so the menu's own padding stays
 * visible and the list visibly "stops" the way a user expects.
 */
function scrollSlashItemIntoView(button: HTMLElement): void {
  const menu = elements.slash;
  const maxScroll = Math.max(0, menu.scrollHeight - menu.clientHeight);
  const buttons = menu.querySelectorAll('.slash-item');

  let target = menu.scrollTop;

  if (button === buttons[0]) {
    target = 0;
  } else if (button === buttons[buttons.length - 1]) {
    target = maxScroll;
  } else {
    const itemTop = button.offsetTop;
    const itemBottom = itemTop + button.offsetHeight;

    if (itemTop < target) {
      target = itemTop;
    } else if (itemBottom > target + menu.clientHeight) {
      target = itemBottom - menu.clientHeight;
    }
  }

  const clamped = Math.max(0, Math.min(target, maxScroll));
  if (clamped !== menu.scrollTop) {
    menu.scrollTop = clamped;
  }
}

function positionSlashMenu(): void {
  if (!slashContext) {
    return;
  }
  const coords = editor.view.coordsAtPos(slashContext.to);
  positionPopover(elements.slash, { left: coords.left, top: coords.top, bottom: coords.bottom });
}

function moveSlashSelection(delta: number): void {
  if (slashItems.length === 0) {
    return;
  }
  slashIndex = (slashIndex + delta + slashItems.length) % slashItems.length;
  updateSlashHighlight();
}

function setSlashSelection(index: number): void {
  if (slashItems.length === 0) {
    return;
  }
  slashIndex = Math.max(0, Math.min(index, slashItems.length - 1));
  updateSlashHighlight();
}

function applySlashItem(): void {
  const context = slashContext;
  const item = slashItems[slashIndex];
  if (!context || !item) {
    hideSlashMenu();
    return;
  }

  chain().deleteRange({ from: context.from, to: context.to }).run();
  hideSlashMenu();
  item.run();
}

function hideSlashMenu(): void {
  slashContext = null;
  slashItems = [];
  slashSignature = '';
  slashIndex = 0;
  elements.slash.classList.remove('open');
}

// Keep the editor selection when clicking inside the menus.
elements.slash.addEventListener('mousedown', (event) => {
  event.preventDefault();
  const target = (event.target as HTMLElement).closest('.slash-item') as HTMLElement | null;
  if (target) {
    slashIndex = Number(target.dataset.index ?? 0);
    applySlashItem();
  }
});

// ---------------------------------------------------------------------------
// Bubble (selection) toolbar
// ---------------------------------------------------------------------------
const MARK_ACTIONS: Record<string, () => boolean> = {
  bold: () => editor.isActive('bold'),
  italic: () => editor.isActive('italic'),
  underline: () => editor.isActive('underline'),
  strike: () => editor.isActive('strike'),
  code: () => editor.isActive('code'),
  highlight: () => editor.isActive('highlight'),
  superscript: () => editor.isActive('superscript'),
  subscript: () => editor.isActive('subscript'),
  link: () => editor.isActive('link'),
  blockquote: () => editor.isActive('blockquote'),
  codeblock: () => editor.isActive('codeBlock'),
};

function updateBubbleMenu(): void {
  const { from, to, empty } = editor.state.selection;

  // A cell selection is a table gesture (merge, split, fill) — formatting text
  // is meaningless there, and the table toolbar owns that state instead.
  if (empty || isCellSelection() || !editor.isEditable) {
    hideBubbleMenu();
    return;
  }

  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);

  elements.bubble.classList.add('open');

  const rect = elements.bubble.getBoundingClientRect();
  let left = (start.left + end.left) / 2 - rect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));

  let top = start.top - rect.height - 10;
  if (top < 8) {
    top = end.bottom + 10;
  }

  elements.bubble.style.left = `${left}px`;
  elements.bubble.style.top = `${top}px`;

  for (const [action, isActive] of Object.entries(MARK_ACTIONS)) {
    const button = elements.bubble.querySelector(`[data-action="${action}"]`);
    button?.classList.toggle('active', isActive());
  }

  for (const align of ['left', 'center', 'right', 'justify']) {
    const button = elements.bubble.querySelector(`[data-align="${align}"]`);
    button?.classList.toggle('active', editor.isActive({ textAlign: align }));
  }
}

function hideBubbleMenu(): void {
  elements.bubble.classList.remove('open');
  hidePopover(elements.stylePicker);
}

elements.bubble.addEventListener('mousedown', (event) => event.preventDefault());

elements.bubble.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const alignButton = target.closest('[data-align]') as HTMLElement | null;
  if (alignButton?.dataset.align) {
    chain().setTextAlign(alignButton.dataset.align).run();
    updateBubbleMenu();
    return;
  }

  const button = target.closest('[data-action]') as HTMLElement | null;
  if (!button) {
    return;
  }

  switch (button.dataset.action) {
    case 'bold':
      chain().toggleBold().run();
      break;
    case 'italic':
      chain().toggleItalic().run();
      break;
    case 'underline':
      chain().toggleUnderline().run();
      break;
    case 'strike':
      chain().toggleStrike().run();
      break;
    case 'code':
      chain().toggleCode().run();
      break;
    case 'highlight': {
      const current = editor.getAttributes('highlight').color as string | undefined;
      if (current) {
        chain().unsetHighlight().run();
      } else {
        chain().setHighlight({ color: HIGHLIGHT_COLORS[0] }).run();
      }
      break;
    }
    case 'superscript':
      chain().toggleSuperscript().run();
      break;
    case 'subscript':
      chain().toggleSubscript().run();
      break;
    case 'blockquote':
      chain().toggleBlockquote().run();
      break;
    case 'codeblock':
      chain().toggleCodeBlock().run();
      break;
    case 'link':
      insertLink();
      return;
    case 'link-remove':
      (editor.chain().focus().extendMarkRange('link') as unknown as AnyChain).unsetLink().run();
      break;
    case 'clear':
      chain().unsetAllMarks().clearNodes().run();
      break;
  }

  updateBubbleMenu();
});

// "Turn into" opens the formatting popover next to the toolbar
const turnIntoButton = document.getElementById('block-convert');
turnIntoButton?.addEventListener('mousedown', (event) => event.preventDefault());
turnIntoButton?.addEventListener('click', () => {
  const rect = turnIntoButton.getBoundingClientRect();
  if (elements.stylePicker.classList.contains('open')) {
    hidePopover(elements.stylePicker);
    return;
  }
  hidePopover(elements.emoji);
  positionPopover(elements.stylePicker, { left: rect.left, top: rect.top, bottom: rect.bottom });
});

// ---------------------------------------------------------------------------
// Table toolbar
// ---------------------------------------------------------------------------

/** Position of the table containing the current selection, and its DOM node. */
interface TableContext {
  tablePos: number;
  tableNode: any;
  tableElement: HTMLTableElement | null;
}

function getTableContext(): TableContext | null {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'table') {
      const tablePos = $from.start(depth);
      const dom = editor.view.domAtPos(tablePos);
      const element = (dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement)?.closest(
        'table'
      ) as HTMLTableElement | null;
      return { tablePos, tableNode: node, tableElement: element };
    }
  }

  return null;
}

/** True when several cells are selected (the selection used to merge cells). */
function isCellSelection(): boolean {
  const selection = editor.state.selection as any;

  // `instanceof` is the primary check; the duck-typed fallback keeps this
  // working if a dependency ends up shipping a second copy of the class.
  return (
    selection instanceof CellSelection ||
    (selection?.$anchorCell !== undefined && typeof selection?.forEachCell === 'function')
  );
}

const TABLE_ACTIONS: Record<string, () => void> = {
  'row-before': () => chain().addRowBefore().run(),
  'row-after': () => chain().addRowAfter().run(),
  'row-delete': () => chain().deleteRow().run(),
  'col-before': () => chain().addColumnBefore().run(),
  'col-after': () => chain().addColumnAfter().run(),
  'col-delete': () => chain().deleteColumn().run(),
  merge: () => chain().mergeCells().run(),
  split: () => chain().splitCell().run(),
  'header-row': () => chain().toggleHeaderRow().run(),
  'header-col': () => chain().toggleHeaderColumn().run(),
  'header-cell': () => chain().toggleHeaderCell().run(),
  distribute: () => distributeColumns(),
  'table-delete': () => chain().deleteTable().run(),
};

/**
 * Clears the stored column widths so every column returns to an equal share of
 * the table width (the opposite of dragging the resize handles).
 */
function distributeColumns(): void {
  const context = getTableContext();
  if (!context) {
    return;
  }

  const { tableNode, tablePos } = context;
  const tr = editor.state.tr;
  let changed = false;

  tableNode.descendants((node: any, offset: number) => {
    if ((node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.attrs.colwidth) {
      // +1 because descendants() offsets are relative to the table's content
      tr.setNodeMarkup(tablePos + 1 + offset, undefined, { ...node.attrs, colwidth: null });
      changed = true;
    }
    return true;
  });

  if (changed) {
    editor.view.dispatch(tr);
  }
}

/** Reads a table-level presentation flag. */
function tableFlag(name: 'striped' | 'compact' | 'fitContent'): boolean {
  const context = getTableContext();
  return context ? Boolean(context.tableNode.attrs[name]) : false;
}

/** Updates a table-level presentation flag, keeping the cursor where it is. */
function toggleTableFlag(name: 'striped' | 'compact' | 'fitContent'): void {
  const context = getTableContext();
  if (!context) {
    return;
  }

  const tr = editor.state.tr;
  tr.setNodeMarkup(context.tablePos - 1, undefined, {
    ...context.tableNode.attrs,
    [name]: !context.tableNode.attrs[name],
  });
  editor.view.dispatch(tr);

  // The node view does not apply attributes, so reflect the change immediately.
  syncTableDom();
}

/** Applies a background colour to every selected cell. */
function setCellBackground(value: string | null): void {
  const current = editor.getAttributes('tableCell').backgroundColor as string | null | undefined;
  const headerCurrent = editor.getAttributes('tableHeader').backgroundColor as string | null | undefined;
  if (current === headerCurrent && current === value) {
    return;
  }

  chain().setCellAttribute('backgroundColor', value).run();
}

const ALIGNMENTS: Array<{ id: string; label: string; glyph: string }> = [
  { id: 'left', label: 'Align left', glyph: '⇤' },
  { id: 'center', label: 'Align center', glyph: '⇔' },
  { id: 'right', label: 'Align right', glyph: '⇥' },
];

function buildTableMenu(): void {
  elements.tableMenu.innerHTML = `
    <div class="bubble-row">
      <span class="bubble-group-label">Row</span>
      <button data-table="row-before" title="Add row above">${Icons.rowBefore}</button>
      <button data-table="row-after" title="Add row below">${Icons.rowAfter}</button>
      <button data-table="row-delete" title="Delete row">${Icons.rowDelete}</button>
      <span class="bubble-sep"></span>
      <span class="bubble-group-label">Col</span>
      <button data-table="col-before" title="Add column left">${Icons.colBefore}</button>
      <button data-table="col-after" title="Add column right">${Icons.colAfter}</button>
      <button data-table="col-delete" title="Delete column">${Icons.colDelete}</button>
      <span class="bubble-sep"></span>
      <button data-table="distribute" title="Distribute column widths evenly">${Icons.distribute}</button>
    </div>

    <div class="bubble-row">
      <span class="bubble-group-label">Cell</span>
      <button data-table="merge" title="Merge selected cells">${Icons.mergeCells}</button>
      <button data-table="split" title="Split the merged cell">${Icons.splitCells}</button>
      <span class="bubble-sep"></span>
      <button data-table="header-row" title="Toggle header row">${Icons.headerRow}</button>
      <button data-table="header-col" title="Toggle header column">${Icons.headerColumn}</button>
      <button data-table="header-cell" title="Toggle header cell">H</button>
      <span class="bubble-sep"></span>
      ${ALIGNMENTS.map(
        (item) => `<button data-align="${item.id}" title="${item.label}">${item.glyph}</button>`
      ).join('')}
    </div>

    <div class="bubble-row">
      <span class="bubble-group-label">Fill</span>
      <span class="swatch-row swatch-row-inline">
        ${CELL_COLORS.map(
          (color, index) =>
            `<button class="swatch ${color.value ? '' : 'swatch-reset'}" data-fill="${index}" title="${
              color.value ? color.label : 'No fill'
            }" style="${color.value ? `background:${color.value};` : ''}">${
              color.value ? '' : '&#10005;'
            }</button>`
        ).join('')}
      </span>
      <span class="bubble-sep"></span>
      <button data-table="striped" title="Toggle striped rows">${Icons.stripes}</button>
      <button data-table="compact" title="Toggle compact cells">${Icons.compact}</button>
      <button data-table="fit" title="Toggle fit-to-content width">${Icons.fitWidth}</button>
      <span class="bubble-sep"></span>
      <button data-table="table-delete" title="Delete table" class="danger">${Icons.tableDelete}</button>
    </div>
  `;
}

/** Reflects the current table state on the toolbar buttons (pressed/selected). */
function syncTableMenuState(): void {
  const context = getTableContext();
  if (!context) {
    return;
  }

  const setPressed = (selector: string, pressed: boolean) => {
    elements.tableMenu.querySelector(selector)?.classList.toggle('active', pressed);
  };

  setPressed('[data-table="striped"]', tableFlag('striped'));
  setPressed('[data-table="compact"]', tableFlag('compact'));
  setPressed('[data-table="fit"]', tableFlag('fitContent'));
  setPressed('[data-table="header-row"]', editor.isActive('tableHeader'));
  setPressed('[data-table="header-col"]', hasHeaderColumn());

  const align = editor.getAttributes('tableCell').align ?? editor.getAttributes('tableHeader').align;
  for (const item of ALIGNMENTS) {
    setPressed(`[data-align="${item.id}"]`, align === item.id);
  }

  const background =
    editor.getAttributes('tableCell').backgroundColor ??
    editor.getAttributes('tableHeader').backgroundColor ??
    null;
  const swatches = elements.tableMenu.querySelectorAll('[data-fill]');
  swatches.forEach((swatch) => {
    const index = Number((swatch as HTMLElement).dataset.fill ?? -1);
    const value = CELL_COLORS[index]?.value ?? null;
    swatch.classList.toggle('active', value === background);
  });
}

/** True when every cell of the first column is a header cell. */
function hasHeaderColumn(): boolean {
  const context = getTableContext();
  if (!context?.tableElement) {
    return false;
  }

  const firstRow = context.tableElement.querySelector('tr');
  const firstCell = firstRow?.firstElementChild;
  return firstCell?.tagName.toLowerCase() === 'th';
}

function updateTableMenu(): void {
  const context = editor.isEditable ? getTableContext() : null;

  if (!context) {
    hideTableMenu();
    return;
  }

  // Shown for a caret inside a cell and for a multi-cell (cell) selection, which
  // is the selection required to merge or split. A text selection instead gets
  // the formatting toolbar, which would overlap this one.
  const selection = editor.state.selection;
  const isTableGesture = selection.empty || isCellSelection();
  if (!isTableGesture) {
    hideTableMenu();
    return;
  }

  syncTableMenuState();
  positionTableMenu(context);
  updateTableHandles(context);
  elements.tableMenu.classList.add('open');
}

/**
 * Places the toolbar above the table, or below it when there is no room, so it
 * never covers the first rows on a table near the top of the viewport.
 */
function positionTableMenu(context: TableContext): void {
  const tableRect = context.tableElement?.getBoundingClientRect();
  const coords = editor.view.coordsAtPos(context.tablePos);

  const anchorLeft = tableRect ? tableRect.left : coords.left;
  const anchorTop = tableRect ? tableRect.top : coords.top;
  const anchorBottom = tableRect ? tableRect.bottom : coords.bottom;

  elements.tableMenu.classList.add('open'); // measure with final layout
  const menuRect = elements.tableMenu.getBoundingClientRect();

  const left = Math.max(8, Math.min(anchorLeft, window.innerWidth - menuRect.width - 8));

  let top = anchorTop - menuRect.height - 8;
  if (top < 8) {
    top = Math.min(anchorBottom + 8, window.innerHeight - menuRect.height - 8);
  }

  elements.tableMenu.style.left = `${left}px`;
  elements.tableMenu.style.top = `${Math.max(8, top)}px`;
}

function hideTableMenu(): void {
  elements.tableMenu.classList.remove('open');
  hideTableHandles();
}

elements.tableMenu.addEventListener('mousedown', (event) => event.preventDefault());

elements.tableMenu.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const swatch = target.closest('[data-fill]') as HTMLElement | null;
  if (swatch) {
    const index = Number(swatch.dataset.fill ?? -1);
    setCellBackground(CELL_COLORS[index]?.value ?? null);
    updateTableMenu();
    return;
  }

  const alignButton = target.closest('[data-align]') as HTMLElement | null;
  if (alignButton?.dataset.align) {
    const next = editor.getAttributes('tableCell').align === alignButton.dataset.align ? null : alignButton.dataset.align;
    chain().setCellAttribute('align', next).run();
    updateTableMenu();
    return;
  }

  const button = target.closest('[data-table]') as HTMLElement | null;
  const action = button?.dataset.table;
  if (!action) {
    return;
  }

  if (action === 'striped' || action === 'compact' || action === 'fit') {
    const flag = action === 'fit' ? 'fitContent' : action;
    toggleTableFlag(flag as 'striped' | 'compact' | 'fitContent');
    updateTableMenu();
    return;
  }

  TABLE_ACTIONS[action]?.();
  updateTableMenu();
  updateBubbleMenu();
});

// ---------------------------------------------------------------------------
// Table edge handles (Notion-style quick add)
// ---------------------------------------------------------------------------
type TableHandle = 'row' | 'column';

/**
 * A pair of "+" buttons that sit on the table edges: one below the first column
 * to append a row, one to the right of the first row to append a column.
 */
function updateTableHandles(context: TableContext): void {
  const element = context.tableElement;
  if (!element || !editor.isEditable) {
    hideTableHandles();
    return;
  }

  const rect = element.getBoundingClientRect();
  const columnHandle = document.getElementById('table-handle-column') as HTMLElement;
  const rowHandle = document.getElementById('table-handle-row') as HTMLElement;

  const firstCell = element.querySelector('tr > *') as HTMLElement | null;
  const firstCellRect = firstCell?.getBoundingClientRect();

  // "+ column" — vertically aligned with the first row, just outside the right edge
  if (rect.right + 24 <= window.innerWidth) {
    columnHandle.classList.add('open');
    columnHandle.style.left = `${rect.right + 6}px`;
    columnHandle.style.top = `${(firstCellRect ? firstCellRect.top + firstCellRect.height / 2 : rect.top + 14) - 11}px`;
  } else {
    columnHandle.classList.remove('open');
  }

  // "+ row" — horizontally aligned with the first column, just below the table
  const rowHandleTop = rect.bottom + 6;
  if (rowHandleTop + 24 <= window.innerHeight) {
    rowHandle.classList.add('open');
    rowHandle.style.left = `${(firstCellRect ? firstCellRect.left + firstCellRect.width / 2 : rect.left + 30) - 11}px`;
    rowHandle.style.top = `${rowHandleTop}px`;
  } else {
    rowHandle.classList.remove('open');
  }
}

function hideTableHandles(): void {
  document.getElementById('table-handle-column')?.classList.remove('open');
  document.getElementById('table-handle-row')?.classList.remove('open');
}

/**
 * Moves the selection into the cell matching the selector and appends a row or
 * column after it, so the quick-add handles work without the cursor having to
 * be in the last row/column already.
 */
function appendViaHandle(handle: TableHandle): void {
  const context = getTableContext();
  const element = context?.tableElement;
  if (!element) {
    return;
  }

  const selector =
    handle === 'row' ? 'tr:last-child > *:first-child' : 'tr:first-child > *:last-child';
  const cell = element.querySelector(selector) as HTMLElement | null;
  if (!cell) {
    return;
  }

  const pos = editor.view.posAtDOM(cell, 0);
  editor.chain().focus().setTextSelection(pos + 1).run();

  if (handle === 'row') {
    chain().addRowAfter().run();
  } else {
    chain().addColumnAfter().run();
  }

  updateTableMenu();
}

function setupTableHandles(): void {
  const columnHandle = document.getElementById('table-handle-column');
  const rowHandle = document.getElementById('table-handle-row');

  for (const [element, handle] of [
    [columnHandle, 'column'],
    [rowHandle, 'row'],
  ] as Array<[HTMLElement | null, TableHandle]>) {
    if (!element) {
      continue;
    }
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', () => appendViaHandle(handle));
  }
}

// ---------------------------------------------------------------------------
// Code block language switcher
// ---------------------------------------------------------------------------
/** Languages offered by the switcher, taken from the bundled lowlight grammar set. */
const CODE_LANGUAGES: string[] = ['plaintext', ...Object.keys(common).filter((name) => name !== 'plaintext').sort()];

function buildCodeLangPicker(): void {
  elements.codeLangPicker.innerHTML = `
    <div class="popover-header">Code language</div>
    <div class="lang-list">
      ${CODE_LANGUAGES.map(
        (language) =>
          `<button class="lang-item" data-lang="${language}">${language === 'plaintext' ? 'Plain text' : language}</button>`
      ).join('')}
    </div>
  `;
}

function currentCodeLanguage(): string {
  const language = editor.getAttributes('codeBlock').language as string | undefined;
  return language && language !== 'null' ? language : 'plaintext';
}

function updateCodeMenu(): void {
  if (!editor.isEditable || !editor.isActive('codeBlock')) {
    hideCodeMenu();
    return;
  }

  const language = currentCodeLanguage();
  elements.codeLangLabel.innerText = language === 'plaintext' ? 'Plain text' : language;

  const { $from } = editor.state.selection;
  let codePos = $from.pos;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'codeBlock') {
      codePos = $from.start(depth);
      break;
    }
  }

  const dom = editor.view.domAtPos(codePos);
  const anchorElement = (dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement)?.closest('pre');
  const rect = anchorElement?.getBoundingClientRect();
  const coords = editor.view.coordsAtPos(codePos);

  const anchor = {
    left: rect ? rect.left : coords.left,
    top: rect ? rect.top : coords.top,
    bottom: rect ? rect.top : coords.top,
  };

  elements.codeMenu.classList.add('open');
  const menuRect = elements.codeMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, anchor.bottom - menuRect.height - 8);

  elements.codeMenu.style.left = `${left}px`;
  elements.codeMenu.style.top = `${top}px`;
}

function hideCodeMenu(): void {
  elements.codeMenu.classList.remove('open');
  hidePopover(elements.codeLangPicker);
}

elements.codeMenu.addEventListener('mousedown', (event) => event.preventDefault());

elements.codeLangButton.addEventListener('click', () => {
  const rect = elements.codeLangButton.getBoundingClientRect();
  if (elements.codeLangPicker.classList.contains('open')) {
    hidePopover(elements.codeLangPicker);
    return;
  }
  hideAllPopovers();
  positionPopover(elements.codeLangPicker, { left: rect.left, top: rect.top, bottom: rect.bottom });
});

elements.codeLangPicker.addEventListener('mousedown', (event) => event.preventDefault());

elements.codeLangPicker.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-lang]') as HTMLElement | null;
  const language = button?.dataset.lang;
  if (!language) {
    return;
  }

  // `plaintext` clears the language so the block renders without highlighting
  chain()
    .setCodeBlock({ language: language === 'plaintext' ? '' : language })
    .run();
  hidePopover(elements.codeLangPicker);
  updateCodeMenu();
});

// ---------------------------------------------------------------------------
// Footer view toggles
// ---------------------------------------------------------------------------
elements.btnFocus.addEventListener('click', () => {
  const enabled = document.body.classList.toggle('np-focus-mode');
  elements.btnFocus.classList.toggle('active', enabled);
  elements.btnFocus.title = enabled
    ? 'Focus mode is on — click to show every block'
    : 'Focus mode — dim everything but the current block';
});

elements.btnInvisible.addEventListener('click', () => {
  const storage = (editor.storage as any).invisibleCharacters;
  const wasVisible = typeof storage?.visibility === 'function' ? storage.visibility() : false;
  (editor.commands as unknown as AnyChain).toggleInvisibleCharacters?.();
  elements.btnInvisible.classList.toggle('active', !wasVisible);
  elements.btnInvisible.title = !wasVisible
    ? 'Hide invisible characters'
    : 'Show invisible characters (spaces, breaks)';
});

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------
function findPage(notebookId: string | null, pageId: string | null): IPage | null {
  if (!notebookId || !pageId) {
    return null;
  }
  const notebook = (state.data.notebooks || []).find((nb) => nb.id === notebookId);
  if (!notebook) {
    return null;
  }
  return (notebook.pages || []).find((page) => page.id === pageId) ?? null;
}

function currentHtml(): string {
  return editor.isEmpty ? '' : editor.getHTML();
}

function setSaveState(mode: 'saving' | 'saved' | 'none'): void {
  if (mode === 'none') {
    elements.saveCircle.classList.add('saved');
    elements.saveText.innerText = 'No note open';
    return;
  }
  if (mode === 'saving') {
    elements.saveCircle.classList.remove('saved');
    elements.saveText.innerText = 'Saving...';
    return;
  }
  elements.saveCircle.classList.add('saved');
  elements.saveText.innerText = 'Saved';
}

function updateStats(): void {
  const storage = (editor.storage as any).characterCount;

  if (storage && typeof storage.words === 'function') {
    elements.stats.innerText = `${storage.words()} words · ${storage.characters()} characters`;
    return;
  }

  const text = editor.getText();
  const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  elements.stats.innerText = `${words} words · ${text.length} characters`;
}

function applyPage(page: IPage): void {
  runRemote(() => {
    editor.commands.setContent(contentToHtml(page.content), { emitUpdate: false });
    editor.setEditable(true);
    elements.title.readOnly = false;
    elements.title.placeholder = 'Untitled Note';
    elements.title.value = page.title || '';
  });

  state.lastAppliedContent = page.content;
  setSaveState('saved');
  updateStats();
}

/**
 * Runs a programmatic editor mutation without triggering the auto-save.
 * `setContent` and `setEditable` can both emit update events — directly or
 * through follow-up transactions (e.g. the trailing-node extension) — so the
 * guard is released on the next tick, after those have settled.
 */
function runRemote(mutate: () => void): void {
  isApplyingRemote = true;
  try {
    mutate();
  } finally {
    setTimeout(() => {
      isApplyingRemote = false;
    }, 0);
  }
}

function loadPage(notebookId: string, pageId: string): void {
  const isSamePage =
    state.activeNotebookId === notebookId &&
    state.activePageId === pageId &&
    state.lastAppliedContent !== null;

  // Flush any pending edits before switching pages, otherwise the tail of the
  // previous page's typing would be silently lost.
  flushPendingSave();

  // Re-selecting the same page must not reload from the cached copy: what is on
  // screen can be newer than the cache.
  if (isSamePage) {
    return;
  }

  state.activeNotebookId = notebookId;
  state.activePageId = pageId;

  const page = findPage(notebookId, pageId);
  if (!page) {
    clearView();
    return;
  }

  applyPage(page);
}

function refreshEditor(): void {
  const page = findPage(state.activeNotebookId, state.activePageId);
  if (!page) {
    if (state.activePageId) {
      clearView();
    }
    return;
  }

  // Uncommitted keystrokes exist: applying remote state now would revert what
  // the user is writing, and the pending save would persist the revert.
  if (state.pendingSave) {
    updateStats();
    return;
  }

  if (page.content !== state.lastAppliedContent) {
    applyPage(page);
    return;
  }

  if (document.activeElement !== elements.title) {
    elements.title.value = page.title || '';
  }
  updateStats();
}

function clearView(): void {
  discardPendingSave();

  state.activeNotebookId = null;
  state.activePageId = null;
  state.lastAppliedContent = null;

  runRemote(() => {
    editor.commands.setContent('', { emitUpdate: false });
    editor.setEditable(false);
    elements.title.value = '';
    elements.title.readOnly = true;
    elements.title.placeholder = 'No note open';
  });

  hideAllPopovers();
  hideBubbleMenu();
  hideTableMenu();
  hideCodeMenu();
  hideSlashMenu();
  closeDialog();
  setSaveState('none');
  updateStats();
}

// ---------------------------------------------------------------------------
// Auto-save
// ---------------------------------------------------------------------------
function onContentChange(): void {
  setSaveState('saving');
  updateStats();

  // Capture the target page together with the text: if the user switches pages
  // inside the debounce window, this snapshot still saves into the page it was
  // typed on instead of the newly selected one.
  state.pendingSave = {
    notebookId: state.activeNotebookId,
    pageId: state.activePageId,
    title: elements.title.value.trim() || 'Untitled Note',
    content: currentHtml(),
  };

  if (state.saveTimeout) {
    clearTimeout(state.saveTimeout);
  }
  state.saveTimeout = setTimeout(() => {
    state.saveTimeout = null;
    savePending();
  }, 350);
}

function flushPendingSave(): void {
  if (!state.saveTimeout && !state.pendingSave) {
    return;
  }
  if (state.saveTimeout) {
    clearTimeout(state.saveTimeout);
    state.saveTimeout = null;
  }
  savePending();
}

function discardPendingSave(): void {
  if (state.saveTimeout) {
    clearTimeout(state.saveTimeout);
    state.saveTimeout = null;
  }
  state.pendingSave = null;
}

function savePending(): void {
  const pending = state.pendingSave;
  state.pendingSave = null;

  if (!pending || !pending.notebookId || !pending.pageId) {
    setSaveState('none');
    return;
  }

  vscode.postMessage({
    type: 'updatePage',
    notebookId: pending.notebookId,
    pageId: pending.pageId,
    title: pending.title,
    content: pending.content,
  });

  // Update the local model so a later sync sees the same content.
  const page = findPage(pending.notebookId, pending.pageId);
  if (page) {
    page.title = pending.title;
    page.content = pending.content;
    page.updatedAt = Date.now();
  }

  if (state.activePageId === pending.pageId) {
    state.lastAppliedContent = pending.content;
    setSaveState('saved');
  }
}

// ---------------------------------------------------------------------------
// Chrome (header buttons, title input)
// ---------------------------------------------------------------------------
elements.title.addEventListener('input', onContentChange);

elements.title.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    editor.commands.focus('start');
  }
});

elements.btnCopy.addEventListener('click', () => {
  const title = elements.title.value.trim();
  const body = editor.getText();
  const fullText = (title ? `${title}\n\n` : '') + body;

  navigator.clipboard.writeText(fullText).then(() => {
    elements.btnCopy.innerHTML = Icons.check;
    elements.btnCopy.title = 'Copied to Clipboard!';
    setTimeout(() => {
      elements.btnCopy.innerHTML = Icons.copy;
      elements.btnCopy.title = 'Copy Full Note to Clipboard';
    }, 1500);
  });
});

elements.btnDelete.addEventListener('click', () => {
  if (!state.activeNotebookId || !state.activePageId) {
    return;
  }
  vscode.postMessage({
    type: 'deletePage',
    notebookId: state.activeNotebookId,
    pageId: state.activePageId,
  });
});

// Keyboard: menu navigation must win over ProseMirror's own key handling.
elements.body.addEventListener(
  'keydown',
  (event) => {
    if (!elements.slash.classList.contains('open')) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        moveSlashSelection(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        moveSlashSelection(-1);
        break;
      case 'Home':
        event.preventDefault();
        event.stopPropagation();
        setSlashSelection(0);
        break;
      case 'End':
        event.preventDefault();
        event.stopPropagation();
        setSlashSelection(slashItems.length - 1);
        break;
      case 'PageDown':
        event.preventDefault();
        event.stopPropagation();
        moveSlashSelection(5);
        break;
      case 'PageUp':
        event.preventDefault();
        event.stopPropagation();
        moveSlashSelection(-5);
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        applySlashItem();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        hideSlashMenu();
        break;
    }
  },
  true
);

document.addEventListener('mousedown', (event) => {
  const target = event.target as HTMLElement;
  if (
    !target.closest('#emoji-picker') &&
    !target.closest('#style-picker') &&
    !target.closest('#bubble-menu')
  ) {
    hideAllPopovers();
  }
});

window.addEventListener('resize', () => {
  if (elements.slash.classList.contains('open')) {
    positionSlashMenu();
  }
});

// ---------------------------------------------------------------------------
// Extension host messaging
// ---------------------------------------------------------------------------
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'syncData') {
    state.data = message.data;
    refreshEditor();
  } else if (message.type === 'pageSelected') {
    loadPage(message.notebookId, message.pageId);
  } else if (message.type === 'pageCleared') {
    clearView();
  }
});

buildEmojiPicker();
buildStylePicker();
buildCodeLangPicker();
buildTableMenu();
setupTableHandles();
clearView();
vscode.postMessage({ type: 'ready' });
