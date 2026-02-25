import {
  query,
  type SDKMessage,
  type SDKSystemMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKPartialAssistantMessage,
  type PermissionResult,
} from '@anthropic-ai/claude-code';
import { createLogger } from './logger.js';
import {
  MAX_TURNS,
  AGENT_TIMEOUT_MS,
  PROJECT_ROOT,
} from './config.js';
import type { AgentResult, AgentOptions } from './types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const log = createLogger('agent');

// Security: destructive bash patterns to deny
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[rRf]+\s+)?\//,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bkill\s+-9\s+1\b/,
  /\bchmod\s+777\s+\//,
  />\s*\/dev\/sda/,
  /\bsudo\s+rm\b/,
  /:\(\)\{.*:\|:&\s*\};:/,
  /\bshutdown\b/,
  /\breboot\b/,
];

const SYSTEM_WRITE_PATHS = ['/etc/', '/usr/', '/System/', '/Library/', '/bin/', '/sbin/', '/var/'];

const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /credentials/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
];

// Load CLAUDE.md append content
let claudeMdAppend = '';
try {
  claudeMdAppend = readFileSync(join(PROJECT_ROOT, 'CLAUDE.md'), 'utf-8');
} catch {
  log.warn('No CLAUDE.md found — using default system prompt only');
}

export async function runAgent(
  message: string,
  options: AgentOptions = {},
): Promise<AgentResult> {
  const { sessionId, onPartial, abortSignal } = options;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => abortController.abort());
  }

  let resultText = '';
  let newSessionId = sessionId ?? '';
  let costUsd = 0;
  let turns = 0;
  const errors: string[] = [];

  try {
    const conversation = query({
      prompt: message,
      options: {
        maxTurns: MAX_TURNS,
        appendSystemPrompt: claudeMdAppend
          ? `You are ClaudeClaw, a personal AI assistant accessible via Telegram.\n\n${claudeMdAppend}`
          : 'You are ClaudeClaw, a personal AI assistant accessible via Telegram.',
        ...(sessionId ? { resume: sessionId } : {}),
        abortController,
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool: async (toolName, input, { signal, suggestions }) => {
          // Check bash commands
          if (toolName === 'Bash') {
            const command = String(input.command ?? '');
            for (const pattern of DESTRUCTIVE_PATTERNS) {
              if (pattern.test(command)) {
                log.warn({ toolName, command: command.slice(0, 100) }, 'Destructive command DENIED');
                return { behavior: 'deny' as const, message: `Blocked: destructive command pattern` };
              }
            }
          }

          // Check file writes
          if (toolName === 'Write' || toolName === 'Edit') {
            const filePath = String(input.file_path ?? '');
            for (const prefix of SYSTEM_WRITE_PATHS) {
              if (filePath.startsWith(prefix)) {
                log.warn({ toolName, filePath }, 'System path write DENIED');
                return { behavior: 'deny' as const, message: `Blocked: write to system path ${prefix}` };
              }
            }
            for (const pattern of SENSITIVE_FILE_PATTERNS) {
              if (pattern.test(filePath)) {
                log.warn({ toolName, filePath }, 'Sensitive file write DENIED');
                return { behavior: 'deny' as const, message: `Blocked: write to sensitive file` };
              }
            }
          }

          // Log web access
          if (toolName === 'WebFetch' || toolName === 'WebSearch') {
            log.debug({ toolName, url: input.url ?? input.query }, 'Web access');
          }

          // Allow everything else
          return {
            behavior: 'allow' as const,
            updatedInput: input,
            updatedPermissions: suggestions,
          } satisfies PermissionResult;
        },
      },
    });

    for await (const event of conversation) {
      const msg = event as SDKMessage;

      if (msg.type === 'system') {
        const sysMsg = msg as SDKSystemMessage;
        if (sysMsg.subtype === 'init') {
          newSessionId = sysMsg.session_id;
          log.debug({ sessionId: newSessionId, model: sysMsg.model }, 'Session initialized');
        }
      } else if (msg.type === 'assistant') {
        const aMsg = msg as SDKAssistantMessage;
        if (aMsg.message?.content) {
          const textBlocks = (aMsg.message.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '');
          if (textBlocks.length > 0) {
            resultText = textBlocks.join('\n');
          }
        }
        if (onPartial && resultText) {
          onPartial(resultText);
        }
      } else if (msg.type === 'result') {
        const rMsg = msg as SDKResultMessage;
        newSessionId = rMsg.session_id;
        if (rMsg.subtype === 'success') {
          costUsd = rMsg.total_cost_usd;
          turns = rMsg.num_turns;
          // Use the result text if we don't have content from assistant messages
          if (!resultText && 'result' in rMsg) {
            resultText = rMsg.result;
          }
          log.info({ costUsd, turns }, 'Agent completed');
        } else if (rMsg.subtype === 'error_max_turns') {
          errors.push('Reached maximum turn limit. Try breaking into smaller tasks.');
          costUsd = rMsg.total_cost_usd;
          turns = rMsg.num_turns;
        } else if (rMsg.subtype === 'error_during_execution') {
          errors.push('An error occurred during execution.');
          costUsd = rMsg.total_cost_usd;
          turns = rMsg.num_turns;
          log.error({ subtype: rMsg.subtype }, 'Agent execution error');
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      errors.push('Request timed out. Try a simpler prompt.');
      log.warn('Agent request timed out');
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(errMsg);
      log.error({ err }, 'Agent query failed');
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (errors.length > 0) {
    const errBlock = errors.map((e) => `Warning: ${e}`).join('\n');
    resultText = resultText ? `${resultText}\n\n${errBlock}` : errBlock;
  }

  if (!resultText) {
    resultText = 'No response generated.';
  }

  return { text: resultText, sessionId: newSessionId, costUsd, turns, errors };
}
