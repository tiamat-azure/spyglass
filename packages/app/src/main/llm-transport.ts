import {
  createMockTransport,
  fetchTransport,
  LLM_FAST_BATCH_MS_DEFAULT,
  type LlmTransport
} from '@spyglass/llm';

export function selectTransport(env: NodeJS.ProcessEnv, hasFastKey: boolean): LlmTransport {
  const mode = env.SPYGLASS_LLM_TRANSPORT;
  const delayMs = intOr(env.SPYGLASS_LLM_MOCK_DELAY_MS, 80);
  const tokensPerCall = intOr(env.SPYGLASS_LLM_MOCK_TOKENS, 80);
  if (mode === 'offline' || env.SPYGLASS_LLM_OFFLINE === '1') {
    return createMockTransport({ delayMs: 1, fail: 'network cut' });
  }
  if (mode === 'live' && hasFastKey) {
    return fetchTransport();
  }
  return createMockTransport({ delayMs, tokensPerCall });
}

export function batchMsFromEnv(env: NodeJS.ProcessEnv): number {
  return intOr(env.LLM_FAST_BATCH_MS, LLM_FAST_BATCH_MS_DEFAULT);
}

function intOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
