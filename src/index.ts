import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STORE_DIR, DECAY_INTERVAL_MS, WAL_CHECKPOINT_INTERVAL_MS } from './config.js';
import { initDatabase, runDecaySweep, walCheckpoint, closeDatabase } from './db.js';
import { createBot, startBot, stopBot } from './bot.js';
import { initScheduler, stopAllTasks } from './scheduler.js';
import { initWhatsApp, destroyWhatsApp } from './whatsapp.js';
import { cleanupOldUploads } from './media.js';
import { runAgent } from './agent.js';
import { createLogger } from './logger.js';

const log = createLogger('main');
const LOCK_FILE = join(STORE_DIR, 'claudeclaw.pid');

// ── Lock file ──

function acquireLock(): void {
  mkdirSync(STORE_DIR, { recursive: true });

  if (existsSync(LOCK_FILE)) {
    const existingPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(existingPid, 0); // Check if process exists
      log.error({ pid: existingPid }, 'Another instance is running');
      process.exit(1);
    } catch {
      // Process doesn't exist, stale lock
      log.warn('Removing stale lock file');
    }
  }

  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Ignore
  }
}

// ── Banner ──

function showBanner(): void {
  console.log(`
   ╔═══════════════════════════════════╗
   ║         ClaudeClaw v1.0           ║
   ║   Personal AI Assistant Bridge    ║
   ╚═══════════════════════════════════╝
  `);
}

// ── Main ──

async function main(): Promise<void> {
  showBanner();

  // 1. Acquire lock
  acquireLock();

  // 2. Initialize database
  initDatabase();
  log.info('Database initialized');

  // 3. Run initial decay sweep + schedule periodic
  runDecaySweep();
  setInterval(() => {
    try {
      runDecaySweep();
    } catch (err) {
      log.error({ err }, 'Decay sweep failed');
    }
  }, DECAY_INTERVAL_MS);

  // 4. WAL checkpoint schedule
  setInterval(() => {
    try {
      walCheckpoint();
    } catch (err) {
      log.error({ err }, 'WAL checkpoint failed');
    }
  }, WAL_CHECKPOINT_INTERVAL_MS);

  // 5. Cleanup old uploads
  cleanupOldUploads();

  // 6. Create and start Telegram bot
  const bot = createBot();

  // 7. Initialize scheduler with send function
  const sendFn = async (chatId: string, text: string) => {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch((err) => {
      log.error({ err, chatId }, 'Failed to send scheduled message');
    });
  };

  const runTaskFn = async (prompt: string): Promise<string> => {
    const result = await runAgent(prompt);
    return result.text;
  };

  initScheduler(sendFn, runTaskFn);

  // 8. Initialize WhatsApp bridge
  await initWhatsApp(async (chatJid, from, body) => {
    log.info({ chatJid, from, body: body.slice(0, 50) }, 'WhatsApp message → processing');
    // For now, just log. Full bridge can forward to Telegram.
  });

  // 9. Start bot
  const handle = startBot(bot);

  // 10. Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    stopBot();
    stopAllTasks();
    await destroyWhatsApp();
    closeDatabase();
    releaseLock();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log.info('ClaudeClaw is running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  releaseLock();
  process.exit(1);
});
