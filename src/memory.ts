import {
  searchMemories,
  recentMemories,
  touchMemories,
  saveMemory,
} from './db.js';
import { createLogger } from './logger.js';
import type { MemoryEntry, MemorySector } from './types.js';

const log = createLogger('memory');

const SEMANTIC_SIGNALS = /\b(my|i am|i'm|i prefer|remember|always|never|i like|i hate|i need|i want|my name|call me)\b/i;

export function buildMemoryContext(chatId: string, userMessage: string): string {
  const ftsResults = searchMemories(chatId, userMessage, 3);
  const recents = recentMemories(chatId, 5);

  // Deduplicate by id
  const seen = new Set<number>();
  const combined: MemoryEntry[] = [];

  for (const m of [...ftsResults, ...recents]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      combined.push(m);
    }
  }

  if (combined.length === 0) return '';

  // Touch accessed memories
  touchMemories(combined.map((m) => m.id));

  const lines = combined.map((m) => {
    const tag = m.sector === 'semantic' ? '[fact]' : '[memory]';
    return `${tag} ${m.content}`;
  });

  log.debug({ count: combined.length, chatId }, 'Memory context built');
  return `<memory>\n${lines.join('\n')}\n</memory>`;
}

export function saveConversationTurn(
  chatId: string,
  userMsg: string,
  assistantMsg: string,
): void {
  // Skip short or command messages
  if (userMsg.length <= 20 || userMsg.startsWith('/')) return;

  const sector: MemorySector = SEMANTIC_SIGNALS.test(userMsg) ? 'semantic' : 'episodic';

  // Truncate for storage
  const content = `User: ${userMsg.slice(0, 300)}\nAssistant: ${assistantMsg.slice(0, 500)}`;

  try {
    saveMemory(chatId, content, sector);
    log.debug({ chatId, sector }, 'Conversation turn saved');
  } catch (err) {
    log.error({ err }, 'Failed to save conversation turn');
  }
}
