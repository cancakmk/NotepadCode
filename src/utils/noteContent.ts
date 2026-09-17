/**
 * Note content helpers.
 *
 * Page content is stored as HTML (produced by the rich text editor), but older
 * notes — and content written by AI agents through the MCP tools — are plain
 * text. These helpers detect the format and convert between the two so that
 * search, AI reads and word counts never see raw markup.
 */

const HTML_TAG_PATTERN = /<(p|div|h[1-6]|ul|ol|li|blockquote|pre|code|br|hr|strong|em|b|i|u|s|a|span|img|table)\b[^>]*>/i;

/** True when the stored content is editor-generated HTML rather than plain text. */
export function looksLikeHtml(content: string): boolean {
  return !!content && HTML_TAG_PATTERN.test(content);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Converts plain text to HTML paragraphs so the editor can render legacy notes. */
export function plainTextToHtml(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Strips markup, producing readable plain text (used for AI tools and search). */
export function htmlToPlainText(html: string): string {
  if (!html) {
    return '';
  }

  let text = html
    // Math nodes keep their LaTeX source so formulas are not lost
    .replace(/<(span|div)([^>]*data-type="(?:inline|block)-math"[^>]*)>\s*<\/\1>/gi, (match, tag, attrs) => {
      const latex = /data-latex="([^"]*)"/i.exec(attrs);
      if (!latex) {
        return match;
      }
      const value = decodeEntities(latex[1]);
      return tag.toLowerCase() === 'div' ? `\n${value}\n` : ` ${value} `;
    })
    // Images become a readable placeholder
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = /alt="([^"]*)"/i.exec(tag);
      return alt && alt[1] ? `[Image: ${decodeEntities(alt[1])}]` : '[Image]';
    })
    // Tables: cells separated by pipes, rows by newlines
    .replace(/<\/\s*(td|th)\s*>/gi, ' | ')
    .replace(/<\/\s*tr\s*>/gi, '\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/\s*(p|div|h[1-6]|blockquote|pre|table|tr)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, (tag) => {
      if (/data-type="taskItem"/i.test(tag)) {
        return /data-checked="true"/i.test(tag) ? '☑ ' : '☐ ';
      }
      return '• ';
    })
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  return text
    .replace(/[ \t]*\|[ \t]*\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Decodes the HTML entities the editor produces. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Plain text for any stored content, whatever its format. */
export function contentToPlainText(content: string): string {
  if (!content) {
    return '';
  }
  return looksLikeHtml(content) ? htmlToPlainText(content) : content;
}

/** HTML suitable for the editor, converting legacy plain-text notes on the fly. */
export function contentToHtml(content: string): string {
  if (!content) {
    return '';
  }
  return looksLikeHtml(content) ? content : plainTextToHtml(content);
}
