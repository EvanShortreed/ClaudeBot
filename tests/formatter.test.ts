import { describe, it, expect } from 'vitest';
import { formatForTelegram, splitMessage, escapeHtml } from '../src/formatter.js';

describe('formatForTelegram', () => {
  it('converts bold markdown to HTML', () => {
    expect(formatForTelegram('Hello **world**')).toContain('<b>world</b>');
  });

  it('converts italic markdown to HTML', () => {
    expect(formatForTelegram('Hello *world*')).toContain('<i>world</i>');
  });

  it('converts strikethrough to HTML', () => {
    expect(formatForTelegram('Hello ~~world~~')).toContain('<s>world</s>');
  });

  it('converts inline code to HTML', () => {
    const result = formatForTelegram('Use `npm install`');
    expect(result).toContain('<code>npm install</code>');
  });

  it('converts code blocks to HTML', () => {
    const result = formatForTelegram('```js\nconsole.log("hi")\n```');
    expect(result).toContain('<pre>');
    expect(result).toContain('console.log');
  });

  it('escapes HTML entities in regular text', () => {
    const result = formatForTelegram('Use <div> & "quotes"');
    expect(result).toContain('&lt;div&gt;');
    expect(result).toContain('&amp;');
  });

  it('escapes HTML inside code blocks', () => {
    const result = formatForTelegram('```\n<script>alert("xss")</script>\n```');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('converts headings to bold', () => {
    const result = formatForTelegram('# Title\n## Subtitle');
    expect(result).toContain('<b>Title</b>');
    expect(result).toContain('<b>Subtitle</b>');
  });

  it('strips horizontal rules', () => {
    const result = formatForTelegram('Before\n---\nAfter');
    expect(result).not.toContain('---');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('handles nested bold and italic', () => {
    const result = formatForTelegram('This is **bold and *italic***');
    expect(result).toContain('<b>');
  });

  it('handles empty input', () => {
    expect(formatForTelegram('')).toBe('');
  });
});

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = splitMessage('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('splits at newlines when possible', () => {
    const line = 'A'.repeat(2000);
    const text = `${line}\n${line}\n${line}`;
    const result = splitMessage(text, 4096);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should be <= limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('splits at spaces when no newlines available', () => {
    const words = Array(500).fill('word').join(' ');
    const result = splitMessage(words, 100);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('hard splits when no good break point exists', () => {
    const noSpaces = 'A'.repeat(200);
    const result = splitMessage(noSpaces, 50);
    expect(result.length).toBe(4);
    expect(result[0].length).toBe(50);
  });

  it('handles exactly 4096 chars', () => {
    const text = 'A'.repeat(4096);
    const result = splitMessage(text);
    expect(result).toEqual([text]);
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
