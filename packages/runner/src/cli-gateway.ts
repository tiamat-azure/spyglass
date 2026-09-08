import {
  createMockTransport,
  fetchTransport,
  LlmGateway,
  type LlmTransport,
  resolveProfile
} from '@spyglass/llm';

/** CLI / CI gateway: mock when no key or SPYGLASS_LLM_TRANSPORT=mock. */
export function createCliGateway(env: NodeJS.ProcessEnv = process.env): LlmGateway {
  const smart = resolveProfile('smart', env);
  const fast = resolveProfile('fast', env);
  const mock =
    env.SPYGLASS_LLM_TRANSPORT === 'mock' ||
    env.SPYGLASS_LLM_OFFLINE === '1' ||
    (smart.apiKeyEnv === undefined && env.LLM_SMART_API_KEY === undefined);
  const transport: LlmTransport = mock
    ? createMockTransport({
        delayMs: 1,
        ...(env.SPYGLASS_MOCK_RECOVER_SELECTOR !== undefined
          ? { recoverSelector: env.SPYGLASS_MOCK_RECOVER_SELECTOR }
          : {})
      })
    : fetchTransport();
  return new LlmGateway({
    transport,
    profiles: () => ({
      fast: {
        provider: fast.provider,
        model: fast.model,
        baseUrl: fast.baseUrl,
        apiKey: fast.apiKeyEnv ?? '',
        timeoutMs: fast.timeoutMs
      },
      smart: {
        provider: smart.provider,
        model: smart.model,
        baseUrl: smart.baseUrl,
        apiKey: smart.apiKeyEnv ?? env.LLM_SMART_API_KEY ?? '',
        timeoutMs: smart.timeoutMs
      }
    })
  });
}
