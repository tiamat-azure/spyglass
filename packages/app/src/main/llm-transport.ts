import {
  createMockTransport,
  fetchTransport,
  LLM_FAST_BATCH_MS_DEFAULT,
  type LlmTransport
} from '@spyglass/llm';

export type TransportMode = 'offline' | 'mock' | 'live';

/**
 * T1a: a saved API key selects live fetch. Mock remains for CI (no key or
 * explicit `SPYGLASS_LLM_TRANSPORT=mock`). Offline env always fails closed.
 */
export function resolveTransportMode(env: NodeJS.ProcessEnv, hasFastKey: boolean): TransportMode {
  if (isLlmOffline(env)) {
    return 'offline';
  }
  if (env.SPYGLASS_LLM_TRANSPORT === 'mock') {
    return 'mock';
  }
  if (hasFastKey) {
    return 'live';
  }
  return 'mock';
}

export function selectTransport(env: NodeJS.ProcessEnv, hasFastKey: boolean): LlmTransport {
  const mode = resolveTransportMode(env, hasFastKey);
  const delayMs = intOr(env.SPYGLASS_LLM_MOCK_DELAY_MS, 80);
  const tokensPerCall = intOr(env.SPYGLASS_LLM_MOCK_TOKENS, 80);
  if (mode === 'offline') {
    return createMockTransport({ delayMs: 1, fail: 'network cut' });
  }
  if (mode === 'live') {
    return fetchTransport();
  }
  return createMockTransport({ delayMs, tokensPerCall });
}

export function isLlmOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SPYGLASS_LLM_OFFLINE === '1' || env.SPYGLASS_LLM_TRANSPORT === 'offline';
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
