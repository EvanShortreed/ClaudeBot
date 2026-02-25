import { createWriteStream, readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { UPLOADS_DIR } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('media');

// Ensure uploads dir exists
mkdirSync(UPLOADS_DIR, { recursive: true });

/**
 * Download a file from Telegram by file_id.
 */
export async function downloadMedia(
  botToken: string,
  fileId: string,
  filename?: string,
): Promise<string> {
  // Get file path from Telegram
  const infoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const infoRes = await fetch(infoUrl);
  const infoData = (await infoRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
  };

  if (!infoData.ok || !infoData.result?.file_path) {
    throw new Error(`Failed to get file info for ${fileId}`);
  }

  const remotePath = infoData.result.file_path;
  const ext = extname(remotePath) || '.bin';
  const localName = filename ?? `${fileId}${ext}`;
  const localPath = join(UPLOADS_DIR, localName);

  // Download
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${remotePath}`;
  const res = await fetch(downloadUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download file: ${res.statusText}`);
  }

  const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(localPath));

  log.debug({ fileId, localPath }, 'Media downloaded');
  return localPath;
}

/**
 * Build a message describing a photo for the agent.
 */
export function buildPhotoMessage(caption: string | undefined, filePath: string): string {
  return `[User sent a photo: ${filePath}]${caption ? `\nCaption: ${caption}` : ''}`;
}

/**
 * Build a message describing a document for the agent.
 */
export function buildDocumentMessage(
  fileName: string | undefined,
  caption: string | undefined,
  filePath: string,
): string {
  return `[User sent a document: ${fileName ?? 'unknown'}]\nSaved to: ${filePath}${caption ? `\nCaption: ${caption}` : ''}`;
}

/**
 * Build a message describing a video for the agent.
 */
export function buildVideoMessage(caption: string | undefined, filePath: string): string {
  return `[User sent a video: ${filePath}]${caption ? `\nCaption: ${caption}` : ''}`;
}

/**
 * Clean up old upload files.
 */
export function cleanupOldUploads(maxAgeMs = 24 * 60 * 60 * 1000): number {
  let cleaned = 0;
  const now = Date.now();

  try {
    const files = readdirSync(UPLOADS_DIR);
    for (const file of files) {
      const filePath = join(UPLOADS_DIR, file);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory may not exist yet
  }

  if (cleaned > 0) {
    log.info({ cleaned }, 'Old uploads cleaned');
  }
  return cleaned;
}
