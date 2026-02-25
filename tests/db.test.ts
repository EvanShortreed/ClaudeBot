import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

// Create a test database directly rather than using the module (which depends on config)
function createTestDb() {
  const testDir = join(import.meta.dirname ?? '.', '.test-store');
  mkdirSync(testDir, { recursive: true });
  const dbPath = join(testDir, `test-${Date.now()}.db`);
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS cost_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      turns INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  return { db, dbPath };
}

describe('Database', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    dbPath = result.dbPath;
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(dbPath, { force: true });
      rmSync(dbPath + '-wal', { force: true });
      rmSync(dbPath + '-shm', { force: true });
    } catch {}
  });

  it('uses WAL mode', () => {
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
  });

  describe('memories CRUD', () => {
    it('inserts and retrieves memories', () => {
      db.prepare(
        'INSERT INTO memories (chat_id, content, sector) VALUES (?, ?, ?)',
      ).run('user1', 'Test memory content', 'episodic');

      const rows = db
        .prepare('SELECT * FROM memories WHERE chat_id = ?')
        .all('user1') as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe('Test memory content');
      expect(rows[0].sector).toBe('episodic');
    });

    it('FTS5 syncs on insert', () => {
      db.prepare(
        'INSERT INTO memories (chat_id, content, sector) VALUES (?, ?, ?)',
      ).run('user1', 'The quick brown fox jumps over the lazy dog', 'semantic');

      const results = db
        .prepare(
          `SELECT m.* FROM memories m
           JOIN memories_fts f ON f.rowid = m.id
           WHERE memories_fts MATCH ?`,
        )
        .all('quick fox') as any[];

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('quick brown fox');
    });

    it('FTS5 syncs on delete', () => {
      db.prepare(
        'INSERT INTO memories (chat_id, content, sector) VALUES (?, ?, ?)',
      ).run('user1', 'Deletable content here', 'episodic');

      db.prepare('DELETE FROM memories WHERE chat_id = ?').run('user1');

      const results = db
        .prepare(
          `SELECT * FROM memories_fts WHERE memories_fts MATCH ?`,
        )
        .all('deletable') as any[];

      expect(results).toHaveLength(0);
    });

    it('isolates memories per user', () => {
      db.prepare(
        'INSERT INTO memories (chat_id, content, sector) VALUES (?, ?, ?)',
      ).run('user1', 'User 1 memory', 'episodic');
      db.prepare(
        'INSERT INTO memories (chat_id, content, sector) VALUES (?, ?, ?)',
      ).run('user2', 'User 2 memory', 'episodic');

      const user1 = db
        .prepare('SELECT * FROM memories WHERE chat_id = ?')
        .all('user1') as any[];
      const user2 = db
        .prepare('SELECT * FROM memories WHERE chat_id = ?')
        .all('user2') as any[];

      expect(user1).toHaveLength(1);
      expect(user2).toHaveLength(1);
      expect(user1[0].content).toBe('User 1 memory');
      expect(user2[0].content).toBe('User 2 memory');
    });
  });

  describe('transactions', () => {
    it('rolls back on error', () => {
      const insertTwo = db.transaction(() => {
        db.prepare(
          'INSERT INTO memories (chat_id, content, sector) VALUES (?, ?, ?)',
        ).run('user1', 'First', 'episodic');
        throw new Error('Simulated error');
      });

      expect(() => insertTwo()).toThrow('Simulated error');

      const rows = db
        .prepare('SELECT * FROM memories WHERE chat_id = ?')
        .all('user1') as any[];
      expect(rows).toHaveLength(0);
    });
  });

  describe('sessions', () => {
    it('upserts sessions', () => {
      db.prepare(
        `INSERT INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = unixepoch()`,
      ).run('user1', 'session-abc');

      const row = db
        .prepare('SELECT session_id FROM sessions WHERE chat_id = ?')
        .get('user1') as any;
      expect(row.session_id).toBe('session-abc');

      // Update
      db.prepare(
        `INSERT INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = unixepoch()`,
      ).run('user1', 'session-def');

      const updated = db
        .prepare('SELECT session_id FROM sessions WHERE chat_id = ?')
        .get('user1') as any;
      expect(updated.session_id).toBe('session-def');
    });
  });

  describe('cost_log', () => {
    it('tracks costs per user', () => {
      db.prepare(
        'INSERT INTO cost_log (chat_id, cost_usd, turns, model) VALUES (?, ?, ?, ?)',
      ).run('user1', 0.05, 3, 'claude');
      db.prepare(
        'INSERT INTO cost_log (chat_id, cost_usd, turns, model) VALUES (?, ?, ?, ?)',
      ).run('user1', 0.03, 2, 'claude');

      const row = db
        .prepare('SELECT SUM(cost_usd) as total FROM cost_log WHERE chat_id = ?')
        .get('user1') as any;
      expect(row.total).toBeCloseTo(0.08);
    });
  });
});
