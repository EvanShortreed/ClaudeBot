// Agent
export interface AgentResult {
  text: string;
  sessionId: string;
  costUsd: number;
  turns: number;
  errors: string[];
}

export type OnPartialCallback = (chunk: string) => void;

export interface AgentOptions {
  sessionId?: string;
  onPartial?: OnPartialCallback;
  abortSignal?: AbortSignal;
}

// Voice
export interface VoiceCapabilities {
  stt: boolean;
  tts: boolean;
}

// Memory
export type MemorySector = 'semantic' | 'episodic';

export interface MemoryEntry {
  id: number;
  chat_id: string;
  topic_key: string;
  content: string;
  sector: MemorySector;
  salience: number;
  created_at: number;
  accessed_at: number;
}

// Scheduler
export type TaskStatus = 'active' | 'paused' | 'deleted';

export interface ScheduledTask {
  id: number;
  chat_id: string;
  prompt: string;
  schedule: string;
  timezone: string;
  next_run: number | null;
  last_run: number | null;
  last_result: string | null;
  status: TaskStatus;
  created_at: number;
}

// Security
export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
) => PolicyDecision;

export interface SecurityPolicy {
  canUseTool: CanUseToolFn;
  sandbox: { enabled: boolean };
}

// Cost
export interface CostEntry {
  chat_id: string;
  cost_usd: number;
  turns: number;
  model: string;
  timestamp: number;
}

// WhatsApp
export interface WaOutboxMessage {
  id: number;
  chat_jid: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  created_at: number;
}
