import { renameSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { GROQ_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from './config.js';
import { createLogger } from './logger.js';
import type { VoiceCapabilities } from './types.js';

const log = createLogger('voice');

export function voiceCapabilities(): VoiceCapabilities {
  return {
    stt: !!GROQ_API_KEY,
    tts: !!ELEVENLABS_API_KEY,
  };
}

/**
 * Transcribe audio using Groq Whisper API.
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

  // Groq needs .ogg not .oga
  let actualPath = filePath;
  if (extname(filePath) === '.oga') {
    actualPath = filePath.replace(/\.oga$/, '.ogg');
    if (!existsSync(actualPath)) {
      renameSync(filePath, actualPath);
    }
  }

  const formData = new FormData();
  const { readFile } = await import('node:fs/promises');
  const fileBytes = await readFile(actualPath);
  const blob = new Blob([fileBytes as unknown as BlobPart], { type: 'audio/ogg' });
  formData.append('file', blob, 'audio.ogg');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq STT failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { text: string };
  log.info({ chars: data.text.length }, 'Audio transcribed');
  return data.text;
}

/**
 * Synthesize speech using ElevenLabs WebSocket streaming.
 * Falls back to HTTP POST on WebSocket failure.
 */
export async function synthesizeSpeechStreaming(text: string): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

  // Truncate very long text for TTS
  const ttsText = text.length > 5000 ? text.slice(0, 5000) + '...' : text;

  try {
    return await ttsViaWebSocket(ttsText);
  } catch (err) {
    log.warn({ err }, 'WebSocket TTS failed, falling back to HTTP');
    return await ttsViaHttp(ttsText);
  }
}

async function ttsViaWebSocket(text: string): Promise<Buffer> {
  const voiceId = ELEVENLABS_VOICE_ID;
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_turbo_v2_5`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const audioChunks: Buffer[] = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('WebSocket TTS timeout'));
      }
    }, 30000);

    ws.addEventListener('open', () => {
      // Send initial config
      ws.send(
        JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          xi_api_key: ELEVENLABS_API_KEY,
        }),
      );

      // Send text in sentence chunks
      const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
      for (const sentence of sentences) {
        ws.send(JSON.stringify({ text: sentence + ' ', try_trigger_generation: true }));
      }

      // Signal end
      ws.send(JSON.stringify({ text: '' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          audio?: string;
          isFinal?: boolean;
        };
        if (data.audio) {
          audioChunks.push(Buffer.from(data.audio, 'base64'));
        }
        if (data.isFinal) {
          clearTimeout(timeout);
          resolved = true;
          ws.close();
          resolve(Buffer.concat(audioChunks));
        }
      } catch {
        // Ignore parse errors on non-JSON messages
      }
    });

    ws.addEventListener('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        reject(err);
      }
    });

    ws.addEventListener('close', () => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('WebSocket closed without audio'));
        }
      }
    });
  });
}

async function ttsViaHttp(text: string): Promise<Buffer> {
  const voiceId = ELEVENLABS_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs HTTP TTS failed (${res.status})`);
  }

  return Buffer.from(await res.arrayBuffer());
}

