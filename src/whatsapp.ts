import { createLogger } from './logger.js';
import {
  enqueueWaMessage,
  getPendingWaMessages,
  markWaMessageSent,
  saveWaMessage,
} from './db.js';
import { WHATSAPP_ENABLED } from './config.js';

const log = createLogger('whatsapp');

type OnIncomingFn = (chatJid: string, from: string, body: string) => Promise<void>;

let client: any = null;
let isReady = false;

export async function initWhatsApp(onIncoming: OnIncomingFn): Promise<void> {
  if (!WHATSAPP_ENABLED) {
    log.info('WhatsApp disabled');
    return;
  }

  try {
    // Dynamic import to avoid loading puppeteer if not needed
    const { default: pkg } = await import('whatsapp-web.js');
    const { Client, LocalAuth } = pkg;
    const qrcode = await import('qrcode-terminal');

    client = new Client({
      authStrategy: new LocalAuth({ clientId: 'claudeclaw' }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      },
      webVersionCache: {
        type: 'local',
        path: './.wwebjs_cache/',
      },
    });

    client.on('qr', (qr: string) => {
      log.info('WhatsApp QR code generated — scan with your phone');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      isReady = true;
      log.info('WhatsApp client ready');
      processOutbox();
    });

    client.on('authenticated', () => {
      log.info('WhatsApp authenticated');
    });

    client.on('auth_failure', (msg: string) => {
      log.error({ msg }, 'WhatsApp auth failure');
    });

    client.on('disconnected', async (reason: string) => {
      isReady = false;
      log.warn({ reason }, 'WhatsApp disconnected — reconnecting');
      try {
        await client.destroy();
        await client.initialize();
      } catch (err) {
        log.error({ err }, 'WhatsApp reconnect failed');
      }
    });

    client.on('change_state', (state: string) => {
      log.debug({ state }, 'WhatsApp state changed');
    });

    client.on('message', async (msg: any) => {
      if (msg.from === 'status@broadcast') return;

      saveWaMessage(msg.from, msg.author ?? msg.from, msg.body, true);
      log.debug({ from: msg.from, body: msg.body.slice(0, 50) }, 'WhatsApp message received');

      try {
        await onIncoming(msg.from, msg.author ?? msg.from, msg.body);
      } catch (err) {
        log.error({ err }, 'WhatsApp incoming handler error');
      }
    });

    await client.initialize();
    log.info('WhatsApp client initializing...');
  } catch (err) {
    log.error({ err }, 'Failed to initialize WhatsApp — is whatsapp-web.js installed?');
  }
}

/**
 * Send a message via WhatsApp.
 */
export async function sendWhatsAppMessage(chatJid: string, body: string): Promise<boolean> {
  if (!isReady || !client) {
    // Queue it
    enqueueWaMessage(chatJid, body);
    return false;
  }

  try {
    await client.sendMessage(chatJid, body);
    saveWaMessage(chatJid, 'me', body, false);
    return true;
  } catch (err) {
    log.error({ err, chatJid }, 'Failed to send WhatsApp message');
    enqueueWaMessage(chatJid, body);
    return false;
  }
}

/**
 * Process queued outbox messages.
 */
async function processOutbox(): Promise<void> {
  if (!isReady || !client) return;

  const pending = getPendingWaMessages();
  for (const msg of pending) {
    try {
      await client.sendMessage(msg.chat_jid, msg.body);
      markWaMessageSent(msg.id, 'sent');
      saveWaMessage(msg.chat_jid, 'me', msg.body, false);
    } catch (err) {
      log.error({ err, msgId: msg.id }, 'Failed to send queued WA message');
      markWaMessageSent(msg.id, 'failed');
    }
  }
}

/**
 * Get list of WhatsApp chats.
 */
export async function getWhatsAppChats(): Promise<Array<{ jid: string; name: string }>> {
  if (!isReady || !client) return [];

  try {
    const chats = await client.getChats();
    return chats.slice(0, 20).map((c: any) => ({
      jid: c.id._serialized,
      name: c.name || c.id.user,
    }));
  } catch {
    return [];
  }
}

export function isWhatsAppReady(): boolean {
  return isReady;
}

export async function destroyWhatsApp(): Promise<void> {
  if (client) {
    try {
      await client.destroy();
    } catch {
      // Ignore destroy errors on shutdown
    }
    isReady = false;
  }
}
