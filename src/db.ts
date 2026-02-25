import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from './config.js';
import { createLogger } from './logger.js';
import type {
  MemoryEntry,
  MemorySector,
  ScheduledTask,
  TaskStatus,
  WaOutboxMessage,
} from './types.js';

const log = createLogger('db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

export function initDatabase(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  createTables();
  log.info({ path: DB_PATH }, 'Database initialized');
  return db;
}

function createTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic', 'episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      accessed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id);
    CREATE INDEX IF NOT EXISTS idx_memories_salience ON memories(salience);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/Chicago',
      next_run INTEGER,
      last_run INTEGER,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'deleted')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_next ON scheduled_tasks(status, next_run);

    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      from_jid TEXT,
      body TEXT NOT NULL,
      is_incoming INTEGER NOT NULL DEFAULT 1,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS wa_message_map (
      wa_msg_id TEXT PRIMARY KEY,
      tg_chat_id TEXT NOT NULL,
      tg_msg_id INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      turns INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cost_chat ON cost_log(chat_id);
  `);
}

// ── Sessions ──

export function getSession(chatId: string): string | undefined {
  const row = getDb()
    .prepare('SELECT session_id FROM sessions WHERE chat_id = ?')
    .get(chatId) as { session_id: string } | undefined;
  return row?.session_id;
}

export function saveSession(chatId: string, sessionId: string): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = unixepoch()`,
    )
    .run(chatId, sessionId);
}

export function clearSession(chatId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId);
}

// ── Memories ──

export function searchMemories(chatId: string, query: string, limit = 3): MemoryEntry[] {
  const sanitized = query.replace(/[^\w\s]/g, ' ').trim();
  if (!sanitized) return [];
  const ftsQuery = sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w}*`)
    .join(' ');

  return getDb()
    .prepare(
      `SELECT m.* FROM memories m
       JOIN memories_fts f ON f.rowid = m.id
       WHERE m.chat_id = ? AND memories_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(chatId, ftsQuery, limit) as MemoryEntry[];
}

export function recentMemories(chatId: string, limit = 5): MemoryEntry[] {
  return getDb()
    .prepare(
      `SELECT * FROM memories WHERE chat_id = ?
       ORDER BY accessed_at DESC LIMIT ?`,
    )
    .all(chatId, limit) as MemoryEntry[];
}

export function touchMemories(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  getDb()
    .prepare(
      `UPDATE memories SET accessed_at = unixepoch(), salience = MIN(salience + 0.1, 5.0)
       WHERE id IN (${placeholders})`,
    )
    .run(...ids);
}

export function saveMemory(chatId: string, content: string, sector: MemorySector, topicKey = ''): void {
  const d = getDb();
  const run = d.transaction(() => {
    d.prepare(
      `INSERT INTO memories (chat_id, topic_key, content, sector) VALUES (?, ?, ?, ?)`,
    ).run(chatId, topicKey, content, sector);
  });
  run();
}

export function getMemoryCount(chatId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as cnt FROM memories WHERE chat_id = ?')
    .get(chatId) as { cnt: number };
  return row.cnt;
}

export function deleteMemoriesByChatId(chatId: string): number {
  const info = getDb().prepare('DELETE FROM memories WHERE chat_id = ?').run(chatId);
  return info.changes;
}

export function runDecaySweep(): { decayed: number; deleted: number } {
  const d = getDb();
  const sweep = d.transaction(() => {
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const decayed = d
      .prepare('UPDATE memories SET salience = salience * 0.98 WHERE created_at < ?')
      .run(dayAgo);
    const deleted = d.prepare('DELETE FROM memories WHERE salience < 0.1').run();
    log.info({ decayed: decayed.changes, deleted: deleted.changes }, 'Memory decay sweep');
    return { decayed: decayed.changes, deleted: deleted.changes };
  });
  return sweep();
}

// ── Scheduled Tasks ──

export function createTask(
  chatId: string,
  prompt: string,
  schedule: string,
  timezone: string,
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO scheduled_tasks (chat_id, prompt, schedule, timezone) VALUES (?, ?, ?, ?)`,
    )
    .run(chatId, prompt, schedule, timezone);
  return info.lastInsertRowid as number;
}

export function getActiveTasks(): ScheduledTask[] {
  return getDb()
    .prepare("SELECT * FROM scheduled_tasks WHERE status = 'active'")
    .all() as ScheduledTask[];
}

export function getTasksForChat(chatId: string): ScheduledTask[] {
  return getDb()
    .prepare("SELECT * FROM scheduled_tasks WHERE chat_id = ? AND status != 'deleted'")
    .all(chatId) as ScheduledTask[];
}

export function updateTaskStatus(id: number, status: TaskStatus): void {
  getDb().prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(status, id);
}

export function updateTaskRun(id: number, result: string): void {
  getDb()
    .prepare('UPDATE scheduled_tasks SET last_run = unixepoch(), last_result = ? WHERE id = ?')
    .run(result, id);
}

// ── WhatsApp ──

export function enqueueWaMessage(chatJid: string, body: string): number {
  const info = getDb()
    .prepare('INSERT INTO wa_outbox (chat_jid, body) VALUES (?, ?)')
    .run(chatJid, body);
  return info.lastInsertRowid as number;
}

export function getPendingWaMessages(): WaOutboxMessage[] {
  return getDb()
    .prepare("SELECT * FROM wa_outbox WHERE status = 'pending' ORDER BY created_at")
    .all() as WaOutboxMessage[];
}

export function markWaMessageSent(id: number, status: 'sent' | 'failed'): void {
  getDb().prepare('UPDATE wa_outbox SET status = ? WHERE id = ?').run(status, id);
}

export function saveWaMessage(
  chatJid: string,
  fromJid: string | null,
  body: string,
  isIncoming: boolean,
): void {
  getDb()
    .prepare('INSERT INTO wa_messages (chat_jid, from_jid, body, is_incoming) VALUES (?, ?, ?, ?)')
    .run(chatJid, fromJid, body, isIncoming ? 1 : 0);
}

// ── Cost ──

export function logCost(chatId: string, costUsd: number, turns: number, model: string): void {
  getDb()
    .prepare('INSERT INTO cost_log (chat_id, cost_usd, turns, model) VALUES (?, ?, ?, ?)')
    .run(chatId, costUsd, turns, model);
}

export function getTotalCost(chatId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_log WHERE chat_id = ?')
    .get(chatId) as { total: number };
  return row.total;
}

export function getTodayCost(chatId: string): number {
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_log WHERE chat_id = ? AND timestamp >= ?',
    )
    .get(chatId, startOfDay) as { total: number };
  return row.total;
}

// ── Maintenance ──

export function walCheckpoint(): void {
  getDb().pragma('wal_checkpoint(RESTART)');
  log.debug('WAL checkpoint complete');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}
