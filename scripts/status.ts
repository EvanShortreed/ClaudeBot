#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function check(label: string, fn: () => string): void {
  try {
    const result = fn();
    console.log(`  ✓ ${label}: ${result}`);
  } catch (err) {
    console.log(`  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('\n  ClaudeClaw Health Check\n');

// Node version
check('Node.js', () => process.version);

// Claude CLI
check('Claude CLI', () => {
  const version = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' }).trim();
  return version || 'installed';
});

// .env exists
check('.env file', () => {
  if (existsSync(join(ROOT, '.env'))) return 'found';
  throw new Error('not found — run npm run setup');
});

// Bot token configured
check('Bot token', () => {
  if (!existsSync(join(ROOT, '.env'))) throw new Error('no .env');
  const env = readFileSync(join(ROOT, '.env'), 'utf-8');
  const match = env.match(/TELEGRAM_BOT_TOKEN=(.+)/);
  if (match && match[1] && match[1] !== 'your_bot_token_here') return 'configured';
  throw new Error('not set');
});

// Database
check('Database', () => {
  const dbPath = join(ROOT, 'store', 'claudeclaw.db');
  if (existsSync(dbPath)) {
    const stat = require('node:fs').statSync(dbPath);
    return `${(stat.size / 1024).toFixed(1)} KB`;
  }
  return 'not created yet (will be created on first run)';
});

// Lock file (running instance)
check('Running instance', () => {
  const lockPath = join(ROOT, 'store', 'claudeclaw.pid');
  if (existsSync(lockPath)) {
    const pid = readFileSync(lockPath, 'utf-8').trim();
    try {
      process.kill(parseInt(pid), 0);
      return `running (PID ${pid})`;
    } catch {
      return 'stale lock file (not running)';
    }
  }
  return 'not running';
});

// launchd service (macOS)
if (process.platform === 'darwin') {
  check('launchd service', () => {
    try {
      const result = execSync('launchctl list | grep claudeclaw 2>/dev/null', {
        encoding: 'utf-8',
      }).trim();
      return result ? 'loaded' : 'not loaded';
    } catch {
      return 'not installed';
    }
  });
}

// Store directory
check('Store directory', () => {
  const storePath = join(ROOT, 'store');
  if (existsSync(storePath)) return 'exists';
  throw new Error('missing');
});

console.log();
