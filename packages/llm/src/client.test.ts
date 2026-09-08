import type { RawEvent } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import {
  createMockTransport,
  isMultimodal,
  LlmGateway,
  resolveProfile,
  toTransportRequest
} from './client.ts';
import {
  LLM_FAST_MODEL_DEFAULT,
  LLM_FAST_TIMEOUT_MS_DEFAULT,
  LLM_SMART_TIMEOUT_MS_DEFAULT
} from './constants.ts';
import { parseNarrationResponse } from './narration.ts';

function fieldEvent(text: string, overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    schemaVersion: 1,
    id: 'evt_000124',
    sessionId: 'ses_test',
    ts: 2,
    kind: 'dom.input',
    target: {
      tag: 'input',
      name: 'email',
      accessibleName: 'Email',
      framePath: ['main'],
      shadowPath: []
    },
    value: { masked: false, text },
    page: { url: 'https://exemple.fr/signup', title: 'Inscription' },
    ...overrides
  };
}

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

  it('does not treat ordinary form values like "input" or "test" as outbound leaks', async () => {
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
    const input = await gateway.narrate([fieldEvent('input')]);
    const test = await gateway.narrate([fieldEvent('test')]);
    expect(input.ok).toBe(true);
    expect(test.ok).toBe(true);
    const blob = JSON.stringify(seen);
    expect(blob).not.toContain('"text":"input"');
    expect(blob).not.toContain('"text":"test"');
  });

  it('still forbids masked secrets and sensitive query tokens in the outbound prompt', async () => {
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
    const result = await gateway.narrate([
      {
        ...clickEvent(),
        value: { masked: true, secretRef: 'SECRET_PASSWORD' },
        page: { url: 'https://exemple.fr/login?token=abcd1234', title: 'Connexion' }
      }
    ]);
    expect(result.ok).toBe(true);
    const blob = JSON.stringify(seen);
    expect(blob).not.toContain('SECRET_PASSWORD');
    expect(blob).not.toContain('abcd1234');
  });

  it('does not URIError-halt on a malformed sensitive query value', async () => {
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1 }),
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
    const result = await gateway.narrate([
      fieldEvent('input', {
        page: { url: 'https://app.example/login?token=%E0%A4%A', title: 'Login' }
      })
    ]);
    expect(result.ok).toBe(true);
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

describe('isMultimodal (F-61)', () => {
  it('detects the pinned Sonnet snapshot and warns-capable text-only ids', () => {
    expect(isMultimodal('claude-sonnet-4-5-20250929')).toBe(true);
    expect(isMultimodal('claude-haiku-4-5-20251001')).toBe(false);
    expect(isMultimodal('local-text-llama')).toBe(false);
    expect(isMultimodal('gpt-4o')).toBe(true);
  });
});

describe('resolveProfile', () => {
  it('uses the smart timeout for the smart profile, not the fast budget', () => {
    const fast = resolveProfile('fast', {});
    const smart = resolveProfile('smart', {});
    expect(fast.timeoutMs).toBe(LLM_FAST_TIMEOUT_MS_DEFAULT);
    expect(smart.timeoutMs).toBe(LLM_SMART_TIMEOUT_MS_DEFAULT);
    expect(smart.timeoutMs).not.toBe(fast.timeoutMs);
    expect(resolveProfile('smart', { LLM_SMART_TIMEOUT_MS: '9000' }).timeoutMs).toBe(9000);
    expect(resolveProfile('smart', { LLM_FAST_TIMEOUT_MS: '50' }).timeoutMs).toBe(
      LLM_SMART_TIMEOUT_MS_DEFAULT
    );
  });

  it('pins the undated Sonnet 4.5 alias to the dated I-05 snapshot', () => {
    expect(resolveProfile('smart', {}).model).toBe('claude-sonnet-4-5-20250929');
    expect(resolveProfile('smart', { LLM_SMART_MODEL: 'claude-sonnet-4-5' }).model).toBe(
      'claude-sonnet-4-5-20250929'
    );
    expect(resolveProfile('smart', { LLM_SMART_MODEL: 'claude-sonnet-4-6' }).model).toBe(
      'claude-sonnet-4-6'
    );
  });
});

describe('test connection (T1a fail-closed)', () => {
  it('never treats the mock narrate transport as a successful provider ping', async () => {
    const mock = createMockTransport({ delayMs: 1 });
    const gateway = new LlmGateway({
      transport: mock,
      liveTransport: {
        complete: async () => {
          throw new Error('provider unreachable');
        }
      },
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: LLM_FAST_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test-not-live',
          timeoutMs: 200
        },
        smart: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test-not-live',
          timeoutMs: 200
        }
      })
    });
    const ping = await gateway.testConnection('fast');
    expect(ping.ok).toBe(false);
    expect(ping.error).toMatch(/provider unreachable/);
    const narrate = await gateway.narrate([clickEvent()]);
    expect(narrate.ok).toBe(true);
  });

  it('re-reads a lazy narrate transport after a key is saved', async () => {
    let live = false;
    const mock = createMockTransport({ delayMs: 1 });
    const gateway = new LlmGateway({
      transport: () =>
        live
          ? {
              complete: async () => ({
                text: JSON.stringify({
                  narrations: [{ id: 'evt_000123', text: 'Tu as cliqué sur le bouton live' }]
                }),
                inputTokens: 1,
                outputTokens: 1
              })
            }
          : mock,
      liveTransport: createMockTransport({ delayMs: 1, fail: true }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: LLM_FAST_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: live ? 'sk-saved' : '',
          timeoutMs: 200
        },
        smart: {
          provider: 'anthropic',
          model: 'x',
          baseUrl: '',
          apiKey: '',
          timeoutMs: 50
        }
      })
    });
    live = true;
    const result = await gateway.narrate([clickEvent()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.narrations[0]?.text).toMatch(/live/);
    }
  });
});
