import { Bot, GrammyError, HttpError, InputFile, type Context } from 'grammy';
import { run, sequentialize, type RunnerHandle } from '@grammyjs/runner';
import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';

import {
  TELEGRAM_BOT_TOKEN,
  ALLOWED_CHAT_IDS,
  TYPING_REFRESH_MS,
  STREAM_EDIT_INTERVAL_MS,
  DEFAULT_TIMEZONE,
} from './config.js';
import { runAgent } from './agent.js';
import { buildMemoryContext, saveConversationTurn } from './memory.js';
import { formatForTelegram, splitMessage } from './formatter.js';
import { downloadMedia, buildPhotoMessage, buildDocumentMessage, buildVideoMessage } from './media.js';
import { voiceCapabilities, transcribeAudio, synthesizeSpeechStreaming } from './voice.js';
import {
  getSession,
  saveSession,
  clearSession,
  getMemoryCount,
  deleteMemoriesByChatId,
  logCost,
  getTotalCost,
  getTodayCost,
  createTask,
  getTasksForChat,
} from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('bot');

// Per-user voice mode toggle
const voiceModeUsers = new Set<string>();

let runnerHandle: RunnerHandle | null = null;

function isAuthorized(chatId: string): boolean {
  if (ALLOWED_CHAT_IDS.length === 0) return true;
  return ALLOWED_CHAT_IDS.includes(chatId);
}

async function sendTyping(ctx: Context): Promise<ReturnType<typeof setInterval>> {
  await ctx.replyWithChatAction('typing').catch(() => {});
  return setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, TYPING_REFRESH_MS);
}

async function handleMessage(ctx: Context, rawText: string, forceVoiceReply = false): Promise<void> {
  const chatId = String(ctx.chat?.id ?? '');
  if (!chatId) return;

  if (!isAuthorized(chatId)) {
    await ctx.reply('Unauthorized. Use /chatid to get your ID and add it to ALLOWED_CHAT_IDS.');
    return;
  }

  const typingInterval = await sendTyping(ctx);

  try {
    // Build memory context
    const memoryContext = buildMemoryContext(chatId, rawText);
    const fullPrompt = memoryContext ? `${memoryContext}\n\n${rawText}` : rawText;

    // Get existing session
    const sessionId = getSession(chatId);

    // Send initial "thinking" message
    const thinkingMsg = await ctx.reply('Thinking...');
    let lastEditText = '';
    let lastEditTime = 0;

    const onPartial = (chunk: string) => {
      const now = Date.now();
      if (now - lastEditTime < STREAM_EDIT_INTERVAL_MS) return;
      if (chunk === lastEditText) return;

      lastEditTime = now;
      lastEditText = chunk;

      const display = chunk.length > 4000 ? chunk.slice(-4000) : chunk;
      ctx.api
        .editMessageText(chatId, thinkingMsg.message_id, display)
        .catch(() => {});
    };

    // Run agent
    const result = await runAgent(fullPrompt, { sessionId, onPartial });

    // Save session
    if (result.sessionId) {
      saveSession(chatId, result.sessionId);
    }

    // Save memory
    saveConversationTurn(chatId, rawText, result.text);

    // Log cost
    logCost(chatId, result.costUsd, result.turns, 'claude');

    clearInterval(typingInterval);

    // Voice reply?
    const shouldVoice = forceVoiceReply || voiceModeUsers.has(chatId);
    const vc = voiceCapabilities();

    if (shouldVoice && vc.tts) {
      try {
        const audioBuffer = await synthesizeSpeechStreaming(result.text);
        await ctx.api.deleteMessage(chatId, thinkingMsg.message_id).catch(() => {});
        await ctx.replyWithVoice(new InputFile(audioBuffer, 'response.mp3'));
        const formatted = formatForTelegram(result.text);
        for (const chunk of splitMessage(formatted)) {
          await ctx.reply(chunk, { parse_mode: 'HTML' });
        }
        return;
      } catch (err) {
        log.warn({ err }, 'TTS failed, falling back to text');
      }
    }

    // Text reply
    const formatted = formatForTelegram(result.text);
    const chunks = splitMessage(formatted);

    if (chunks.length === 1) {
      await ctx.api
        .editMessageText(chatId, thinkingMsg.message_id, chunks[0], { parse_mode: 'HTML' })
        .catch(async () => {
          await ctx.api.editMessageText(chatId, thinkingMsg.message_id, result.text).catch(() => {});
        });
    } else {
      await ctx.api.deleteMessage(chatId, thinkingMsg.message_id).catch(() => {});
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' }).catch(async () => {
          await ctx.reply(chunk).catch(() => {});
        });
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    log.error({ err, chatId }, 'Message handling failed');
    await ctx.reply('Something went wrong processing your message. Please try again.').catch(() => {});
  }
}

export function createBot(): Bot {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new Bot(TELEGRAM_BOT_TOKEN);

  // Plugins
  bot.api.config.use(autoRetry());
  bot.api.config.use(apiThrottler());

  // Sequentialize per-chat to avoid race conditions
  bot.use(sequentialize((ctx: Context) => ctx.chat?.id.toString() ?? ''));

  // Global error handler
  bot.catch((err) => {
    const ctx = err.ctx;
    const e = err.error;

    if (e instanceof GrammyError) {
      log.error({ code: e.error_code, desc: e.description }, 'Grammy API error');
    } else if (e instanceof HttpError) {
      log.error({ err: e }, 'HTTP error');
    } else {
      log.error({ err: e }, 'Unhandled bot error');
    }

    ctx.reply('An error occurred. Please try again.').catch(() => {});
  });

  // ── Commands ──

  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Welcome to ClaudeClaw! Send me a message and I\'ll respond using Claude.\n\n' +
        'Commands:\n' +
        '/chatid - Show your chat ID\n' +
        '/newchat - Start a fresh session\n' +
        '/memory - Show memory stats\n' +
        '/forget - Clear all memories\n' +
        '/voice - Toggle voice mode\n' +
        '/cost - Show usage costs\n' +
        '/schedule - Manage scheduled tasks',
    );
  });

  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Your chat ID: <code>${ctx.chat?.id}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('newchat', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    clearSession(chatId);
    await ctx.reply('Session cleared. Starting fresh.');
  });

  bot.command('memory', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;
    const count = getMemoryCount(chatId);
    await ctx.reply(`You have <b>${count}</b> memories stored.`, { parse_mode: 'HTML' });
  });

  bot.command('forget', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;
    const deleted = deleteMemoriesByChatId(chatId);
    await ctx.reply(`Cleared ${deleted} memories.`);
  });

  bot.command('voice', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;
    const vc = voiceCapabilities();

    if (!vc.tts) {
      await ctx.reply('Voice mode unavailable - ELEVENLABS_API_KEY not configured.');
      return;
    }

    if (voiceModeUsers.has(chatId)) {
      voiceModeUsers.delete(chatId);
      await ctx.reply('Voice mode OFF. Responses will be text only.');
    } else {
      voiceModeUsers.add(chatId);
      await ctx.reply('Voice mode ON. Responses will include audio.');
    }
  });

  bot.command('cost', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;
    const total = getTotalCost(chatId);
    const today = getTodayCost(chatId);
    await ctx.reply(
      `<b>Cost Summary</b>\nToday: $${today.toFixed(4)}\nAll time: $${total.toFixed(4)}`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('schedule', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;
    const text = ctx.match?.toString().trim();

    if (!text) {
      const tasks = getTasksForChat(chatId);
      if (tasks.length === 0) {
        await ctx.reply('No scheduled tasks. Use /schedule <cron> <prompt> to create one.');
        return;
      }
      const lines = tasks.map(
        (t) => `#${t.id} [${t.status}] <code>${t.schedule}</code>\n${t.prompt.slice(0, 80)}`,
      );
      await ctx.reply(lines.join('\n\n'), { parse_mode: 'HTML' });
      return;
    }

    const parts = text.split(/\s+/);
    if (parts.length < 6) {
      await ctx.reply('Usage: /schedule <min> <hr> <dom> <mon> <dow> <prompt>');
      return;
    }

    const cronExpr = parts.slice(0, 5).join(' ');
    const prompt = parts.slice(5).join(' ');

    try {
      const id = createTask(chatId, prompt, cronExpr, DEFAULT_TIMEZONE);
      await ctx.reply(`Scheduled task #${id} created.\nCron: <code>${cronExpr}</code>\nPrompt: ${prompt}`, {
        parse_mode: 'HTML',
      });
    } catch (err) {
      await ctx.reply(`Failed to create task: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ── Message Handlers ──

  bot.on('message:text', async (ctx) => {
    await handleMessage(ctx, ctx.message.text);
  });

  bot.on('message:voice', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;

    const vc = voiceCapabilities();
    if (!vc.stt) {
      await ctx.reply('Voice transcription unavailable - GROQ_API_KEY not configured.');
      return;
    }

    try {
      const file = await ctx.getFile();
      const filePath = await downloadMedia(TELEGRAM_BOT_TOKEN, file.file_id);
      const transcription = await transcribeAudio(filePath);
      if (!transcription) {
        await ctx.reply('Could not transcribe audio. Please try again.');
        return;
      }
      await ctx.reply(`<i>Transcription:</i> ${transcription}`, { parse_mode: 'HTML' });
      await handleMessage(ctx, transcription, true);
    } catch (err) {
      log.error({ err }, 'Voice handling failed');
      await ctx.reply('Failed to process voice message.');
    }
  });

  bot.on('message:photo', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;

    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const filePath = await downloadMedia(TELEGRAM_BOT_TOKEN, largest.file_id);
      const msg = buildPhotoMessage(ctx.message.caption, filePath);
      await handleMessage(ctx, msg);
    } catch (err) {
      log.error({ err }, 'Photo handling failed');
      await ctx.reply('Failed to process photo.');
    }
  });

  bot.on('message:document', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;

    try {
      const doc = ctx.message.document;
      const filePath = await downloadMedia(TELEGRAM_BOT_TOKEN, doc.file_id, doc.file_name);
      const msg = buildDocumentMessage(doc.file_name, ctx.message.caption, filePath);
      await handleMessage(ctx, msg);
    } catch (err) {
      log.error({ err }, 'Document handling failed');
      await ctx.reply('Failed to process document.');
    }
  });

  bot.on('message:video', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (!isAuthorized(chatId)) return;

    try {
      const video = ctx.message.video;
      const filePath = await downloadMedia(TELEGRAM_BOT_TOKEN, video.file_id);
      const msg = buildVideoMessage(ctx.message.caption, filePath);
      await handleMessage(ctx, msg);
    } catch (err) {
      log.error({ err }, 'Video handling failed');
      await ctx.reply('Failed to process video.');
    }
  });

  return bot;
}

export function startBot(bot: Bot): RunnerHandle {
  const handle = run(bot);
  runnerHandle = handle;
  log.info('Bot started with grammy runner');
  return handle;
}

export function stopBot(): void {
  if (runnerHandle) {
    runnerHandle.stop();
    log.info('Bot stopped');
  }
}
