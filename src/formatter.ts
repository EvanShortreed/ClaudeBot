import { MAX_MESSAGE_LENGTH } from './config.js';

/**
 * Convert Markdown text to Telegram-safe HTML.
 */
export function formatForTelegram(text: string): string {
  // Extract code blocks to protect them
  const codeBlocks: string[] = [];
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code.trimEnd());
    codeBlocks.push(lang ? `<pre><code class="language-${lang}">${escaped}</code></pre>` : `<pre>${escaped}</pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // Extract inline code
  const inlineCode: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // Escape HTML in remaining text
  result = escapeHtml(result);

  // Markdown conversions
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/\*(.+?)\*/g, '<i>$1</i>');
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');
  result = result.replace(/__(.+?)__/g, '<u>$1</u>');

  // Links: [text](url) — already escaped, need to unescape the parts
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Headings → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Strip horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(`\x00CODEBLOCK${i}\x00`, codeBlocks[i]);
  }
  for (let i = 0; i < inlineCode.length; i++) {
    result = result.replace(`\x00INLINE${i}\x00`, inlineCode[i]);
  }

  return result.trim();
}

/**
 * Escape HTML special characters.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Split a message into chunks that fit Telegram's limit.
 * Prefers splitting on newlines, never mid-word.
 */
export function splitMessage(text: string, limit: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf('\n', limit);

    // If no newline, try a space
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf(' ', limit);
    }

    // If still nothing, hard split at limit
    if (splitIdx <= 0) {
      splitIdx = limit;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, '');
  }

  return chunks;
}
