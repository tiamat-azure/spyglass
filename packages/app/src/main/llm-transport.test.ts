import { describe, expect, it } from 'vitest';
import { batchMsFromEnv, selectTransport } from './llm-transport.ts';

describe('llm transport selection', () => {
  it('defaults to mock so CI never needs a live key', async () => {
    const transport = selectTransport({}, false);
    const result = await transport.complete({
      url: 'https://example.test',
      headers: {},
      body: {
        messages: [{ role: 'user', content: '{"locale":"fr","events":[]}' }]
      },
      timeoutMs: 200,
      profile: 'fast'
    });
    expect(result.text).toContain('narrations');
  });

  it('uses the offline transport when SPYGLASS_LLM_OFFLINE=1', async () => {
    const transport = selectTransport({ SPYGLASS_LLM_OFFLINE: '1' }, true);
    await expect(
      transport.complete({
        url: 'https://example.test',
        headers: {},
        body: {},
        timeoutMs: 20,
        profile: 'fast'
      })
    ).rejects.toThrow(/network cut/);
  });

  it('reads the batch window from env', () => {
    expect(batchMsFromEnv({})).toBe(500);
    expect(batchMsFromEnv({ LLM_FAST_BATCH_MS: '50' })).toBe(50);
  });
});
