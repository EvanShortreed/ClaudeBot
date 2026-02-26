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
  MAX_BUDGET_USD,
  AGENT_TIMEOUT_MS,
  PROJECT_ROOT,
} from './config.js';
import { createSecurityPolicy } from './security.js';
import type { AgentResult, AgentOptions } from './types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const log = createLogger('agent');
const securityPolicy = createSecurityPolicy();

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
        maxBudgetUsd: MAX_BUDGET_USD,
        abortController,
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool: async (toolName, input, { suggestions }) => {
          const decision = securityPolicy.canUseTool(
            toolName,
            input as Record<string, unknown>,
          );

          if (!decision.allowed) {
            return { behavior: 'deny' as const, message: decision.reason ?? 'Blocked by security policy' };
          }

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
        } else if (rMsg.subtype === 'error_max_budget_usd') {
          errors.push(`Budget limit ($${MAX_BUDGET_USD}) reached. Try a simpler prompt.`);
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
