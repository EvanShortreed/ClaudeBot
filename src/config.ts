import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from './env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = readEnvFile();

export const PROJECT_ROOT = join(__dirname, '..');
export const STORE_DIR = join(PROJECT_ROOT, 'store');
export const UPLOADS_DIR = join(PROJECT_ROOT, 'workspace', 'uploads');

// Telegram
export const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN ?? '';
export const ALLOWED_CHAT_IDS: string[] = (env.ALLOWED_CHAT_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Agent limits
export const MAX_TURNS = parseInt(env.MAX_TURNS ?? '25', 10);
export const MAX_BUDGET_USD = parseFloat(env.MAX_BUDGET_USD ?? '2.0');
export const AGENT_TIMEOUT_MS = parseInt(env.AGENT_TIMEOUT_MS ?? '120000', 10);

// Telegram constants
export const MAX_MESSAGE_LENGTH = 4096;
export const TYPING_REFRESH_MS = 4000;
export const STREAM_EDIT_INTERVAL_MS = 500;

// Voice
export const GROQ_API_KEY = env.GROQ_API_KEY ?? '';
export const ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY ?? '';
export const ELEVENLABS_VOICE_ID = env.ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB'; // Adam default

// WhatsApp
export const WHATSAPP_ENABLED = env.WHATSAPP_ENABLED === 'true';

// Scheduling
export const DEFAULT_TIMEZONE = env.DEFAULT_TIMEZONE ?? 'America/Chicago';

// Database
export const DB_PATH = join(STORE_DIR, 'claudeclaw.db');

// Decay
export const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const WAL_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
