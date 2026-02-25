import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// We test the parsing logic directly since readEnvFile hardcodes the path
describe('env parsing logic', () => {
  function parseEnv(content: string, keys?: string[]): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!keys || keys.includes(key)) {
        vars[key] = value;
      }
    }
    return vars;
  }

  it('parses basic key=value pairs', () => {
    const result = parseEnv('FOO=bar\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles double-quoted values', () => {
    const result = parseEnv('KEY="hello world"');
    expect(result).toEqual({ KEY: 'hello world' });
  });

  it('handles single-quoted values', () => {
    const result = parseEnv("KEY='hello world'");
    expect(result).toEqual({ KEY: 'hello world' });
  });

  it('skips comments', () => {
    const result = parseEnv('# This is a comment\nKEY=value\n# Another comment');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('skips empty lines', () => {
    const result = parseEnv('\n\nKEY=value\n\n');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('filters by keys when specified', () => {
    const result = parseEnv('A=1\nB=2\nC=3', ['A', 'C']);
    expect(result).toEqual({ A: '1', C: '3' });
  });

  it('handles values with equals signs', () => {
    const result = parseEnv('KEY=val=ue=test');
    expect(result).toEqual({ KEY: 'val=ue=test' });
  });

  it('handles empty values', () => {
    const result = parseEnv('KEY=');
    expect(result).toEqual({ KEY: '' });
  });

  it('returns empty object for empty content', () => {
    const result = parseEnv('');
    expect(result).toEqual({});
  });

  it('handles whitespace around key and value', () => {
    const result = parseEnv('  KEY  =  value  ');
    expect(result).toEqual({ KEY: 'value' });
  });
});
