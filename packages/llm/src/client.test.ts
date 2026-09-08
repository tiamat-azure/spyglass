import type { RawEvent } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { createMockTransport, LlmGateway, toTransportRequest } from './client.ts';
import { LLM_FAST_MODEL_DEFAULT } from './constants.ts';
import { parseNarrationResponse } from './narration.ts';

function clickEvent(): RawEvent {
  return {
    schemaVersion: 1,
    id: 'evt_000123',
    sessionId: 'ses_test',
    ts: 1,
    kind: 'dom.click',
    target: {
      tag: 'button',
      role: 'button',
      accessibleName: 'Se connecter',
      text: 'Se connecter',
      framePath: ['main'],
      shadowPath: []
    },
    value: { masked: false, text: 'should-not-leak' },
    page: { url: 'https://exemple.fr/login?token=abcd1234', title: 'Connexion' }
  };
}

describe('narration contract', () => {
  it('rejects responses whose id set differs', () => {
    expect(parseNarrationResponse('{"narrations":[]}', ['evt_000123'])).toEqual({
      error: 'id set length mismatch'
    });
    expect(
      parseNarrationResponse('{"narrations":[{"id":"evt_000999","text":"x"}]}', ['evt_000123'])
    ).toEqual({ error: 'id set mismatch' });
    expect(
      parseNarrationResponse('{"narrations":[{"id":"evt_000123","text":"Tu as cliqué"}]}', [
        'evt_000123'
      ])
    ).toMatchObject({
      narrations: [{ id: 'evt_000123', text: 'Tu as cliqué' }]
    });
  });
});

describe('llm gateway', () => {
  it('expurgates before the transport runs and mock-enriches in place', async () => {
    const seen: unknown[] = [];
    const inner = createMockTransport({ delayMs: 1 });
    const gateway = new LlmGateway({
      transport: {
        complete: async (request) => {
          seen.push(request.body);
          return inner.complete(request);
        }
      },
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: LLM_FAST_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
          timeoutMs: 200
        },
        smart: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
          timeoutMs: 200
        }
      })
    });
    const result = await gateway.narrate([clickEvent()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.narrations[0]?.text).toMatch(/bouton Se connecter/);
    }
    const blob = JSON.stringify(seen);
    expect(blob).not.toContain('should-not-leak');
    expect(blob).not.toContain('abcd1234');
  });

  it('treats transport failure as profile unavailability, not a partial parse', async () => {
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, fail: true }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: LLM_FAST_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
          timeoutMs: 200
        },
        smart: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          baseUrl: 'https://api.anthropic.com',
          apiKey: '',
          timeoutMs: 200
        }
      })
    });
    const result = await gateway.narrate([clickEvent()]);
    expect(result.ok).toBe(false);
    const ping = await gateway.testConnection('smart');
    expect(ping.ok).toBe(false);
    expect(ping.error).toMatch(/missing api key/);
  });

  it('builds openai-compatible requests without leaking the user value', () => {
    const request = toTransportRequest(
      'fast',
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        timeoutMs: 100
      },
      'sys',
      '{"locale":"fr","events":[]}'
    );
    expect(request.url).toBe('https://example.test/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer sk-test');
  });
});
