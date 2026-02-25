import { createLogger } from './logger.js';
import type { SecurityPolicy, PolicyDecision } from './types.js';

const log = createLogger('security');

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[rRf]+\s+)?\//, // rm -rf /
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bkill\s+-9\s+1\b/, // kill init
  /\bchmod\s+777\s+\//,
  />\s*\/dev\/sda/,
  /\bsudo\s+rm\b/,
  /\bformat\s+[cC]:/,
  /:(){ :\|:& };:/, // fork bomb
  /\bshutdown\b/,
  /\breboot\b/,
];

const SYSTEM_WRITE_PATHS = [
  '/etc/',
  '/usr/',
  '/System/',
  '/Library/',
  '/bin/',
  '/sbin/',
  '/var/',
  '/tmp/', // still allow /tmp reads
];

const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /credentials/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  /\.ssh\/config/,
];

function checkBash(input: Record<string, unknown>): PolicyDecision {
  const command = String(input.command ?? '');

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Destructive command blocked: ${pattern.source}` };
    }
  }

  return { allowed: true };
}

function checkWrite(input: Record<string, unknown>): PolicyDecision {
  const filePath = String(input.file_path ?? input.filePath ?? '');

  for (const prefix of SYSTEM_WRITE_PATHS) {
    if (filePath.startsWith(prefix)) {
      return { allowed: false, reason: `Write to system path blocked: ${prefix}` };
    }
  }

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return { allowed: false, reason: `Write to sensitive file blocked: ${filePath}` };
    }
  }

  return { allowed: true };
}

export function createSecurityPolicy(): SecurityPolicy {
  const canUseTool = (
    toolName: string,
    input: Record<string, unknown>,
  ): PolicyDecision => {
    let decision: PolicyDecision;

    switch (toolName) {
      case 'Bash':
        decision = checkBash(input);
        break;
      case 'Write':
      case 'Edit':
        decision = checkWrite(input);
        break;
      case 'WebFetch':
      case 'WebSearch':
        log.debug({ toolName, url: input.url ?? input.query }, 'Web access');
        decision = { allowed: true };
        break;
      default:
        decision = { allowed: true };
        break;
    }

    if (!decision.allowed) {
      log.warn({ toolName, reason: decision.reason, input }, 'Tool use DENIED');
    }

    return decision;
  };

  return {
    canUseTool,
    sandbox: { enabled: true },
  };
}
