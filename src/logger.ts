import pino from 'pino';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = join(__dirname, '..', 'store');

// Ensure store directory exists
mkdirSync(STORE_DIR, { recursive: true });

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      level: 'info',
      options: { destination: 1, colorize: true },
    },
    {
      target: 'pino/file',
      level: 'error',
      options: { destination: join(STORE_DIR, 'error.log'), mkdir: true },
    },
    {
      target: 'pino/file',
      level: 'debug',
      options: { destination: join(STORE_DIR, 'debug.log'), mkdir: true },
    },
  ],
});

const rootLogger = pino(
  {
    level: 'debug',
    redact: {
      paths: [
        'apiKey',
        'token',
        'password',
        '*.GROQ_API_KEY',
        '*.ELEVENLABS_API_KEY',
        '*.BOT_TOKEN',
        '*.TELEGRAM_BOT_TOKEN',
        '*.WHATSAPP_SESSION',
      ],
      censor: '[REDACTED]',
    },
  },
  transport,
);

export function createLogger(module: string) {
  return rootLogger.child({ module });
}

export default rootLogger;
