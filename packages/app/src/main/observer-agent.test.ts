import type { RawEvent } from '@spyglass/contracts';
import { createMockTransport, FastTokenBudget, LlmGateway } from '@spyglass/llm';
import { describe, expect, it } from 'vitest';
import type { ChatEnrichedPayload, ChatMessagePayload, UsagePayload } from '../shared/ipc.ts';
import { ObserverAgent, technicalBlock } from './observer-agent.ts';

function click(id: string): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_test',
    ts: 1,
    kind: 'dom.click',
    stepIndex: 1,
    target: {
      tag: 'button',
      role: 'button',
      accessibleName: 'Start',
      text: 'Start',
      framePath: ['main'],
      shadowPath: []
    },
    narration: { mode: 'template', text: 'Tu as cliqué sur « Start »' }
  };
}

describe('observer agent', () => {
  it('emits a gabarit chat message before enrichment replaces it', async () => {
    const chat: ChatMessagePayload[] = [];
    const enriched: ChatEnrichedPayload[] = [];
    const usage: UsagePayload[] = [];
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 5, tokensPerCall: 20 }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
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
    const agent = new ObserverAgent(
      {
        emitChat: (message) => {
          chat.push(message);
        },
        emitEnriched: (payload) => {
          enriched.push(payload);
        },
        emitUsage: (payload) => {
          usage.push(payload);
        },
        appendAgent: async () => undefined
      },
      {
        gateway,
        budget: new FastTokenBudget({ ceiling: 10_000 }),
        windowMs: 1,
        enrichmentEnabled: () => true,
        modelName: () => 'claude-haiku-4-5-20251001'
      }
    );
    agent.onSessionStart('ses_test');
    const started = Date.now();
    agent.onRawEvent(click('evt_000001'));
    const gabaritDelay = Date.now() - started;
    expect(gabaritDelay).toBeLessThan(200);
    expect(chat[0]?.mode).toBe('template');
    expect(chat[0]?.text).toContain('Tu as cliqué');
    expect(chat[0]?.technical).toContain('dom.click');
    await agent.flush();
    expect(enriched[0]?.mode).toBe('llm');
    expect(enriched[0]?.text).not.toBe(chat[0]?.text);
    agent.dispose();
  });

  it('stays on gabarits when enrichment is disabled, without dropping events', async () => {
    const chat: ChatMessagePayload[] = [];
    const enriched: ChatEnrichedPayload[] = [];
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, fail: true }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          baseUrl: 'https://api.anthropic.com',
          apiKey: '',
          timeoutMs: 50
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
    const agent = new ObserverAgent(
      {
        emitChat: (message) => {
          chat.push(message);
        },
        emitEnriched: (payload) => {
          enriched.push(payload);
        },
        emitUsage: () => undefined,
        appendAgent: async () => undefined
      },
      {
        gateway,
        budget: new FastTokenBudget({ ceiling: 10_000 }),
        windowMs: 1,
        enrichmentEnabled: () => false,
        modelName: () => 'claude-haiku-4-5-20251001'
      }
    );
    agent.onSessionStart('ses_test');
    agent.setEnabled(false);
    agent.onRawEvent(click('evt_000001'));
    agent.onRawEvent({ ...click('evt_000002'), id: 'evt_000002', stepIndex: 2 });
    await agent.flush();
    expect(chat.filter((row) => row.mode === 'template')).toHaveLength(2);
    expect(enriched).toHaveLength(0);
    agent.dispose();
  });

  it('warns then suspends enrichment at a low ceiling while still emitting gabarits', async () => {
    const chat: ChatMessagePayload[] = [];
    const enriched: ChatEnrichedPayload[] = [];
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, tokensPerCall: 80 }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
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
    const agent = new ObserverAgent(
      {
        emitChat: (message) => {
          chat.push(message);
        },
        emitEnriched: (payload) => {
          enriched.push(payload);
        },
        emitUsage: () => undefined,
        appendAgent: async () => undefined
      },
      {
        gateway,
        budget: new FastTokenBudget({ ceiling: 100, warnRatio: 0.5, rateLimitPerMin: 60 }),
        windowMs: 1,
        enrichmentEnabled: () => true,
        modelName: () => 'claude-haiku-4-5-20251001'
      }
    );
    agent.onSessionStart('ses_test');
    agent.onRawEvent(click('evt_000001'));
    await agent.flush();
    agent.onRawEvent({ ...click('evt_000002'), id: 'evt_000002' });
    await agent.flush();
    agent.onRawEvent({ ...click('evt_000003'), id: 'evt_000003' });
    await agent.flush();
    expect(chat.some((row) => row.banner === 'warning')).toBe(true);
    expect(chat.some((row) => row.text.includes('Plafond') && row.banner === 'danger')).toBe(true);
    expect(chat.filter((row) => row.eventId.startsWith('evt_'))).toHaveLength(3);
    expect(enriched.length).toBeLessThan(3);
    agent.dispose();
  });

  it('redacts page query and password keystrokes from the collapsible tech block', () => {
    const tech = technicalBlock({
      schemaVersion: 1,
      id: 'evt_000040',
      sessionId: 'ses_test',
      ts: 1,
      kind: 'dom.key',
      stepIndex: 4,
      page: { url: 'https://exemple.fr/login?token=abcd1234&q=ok', title: 'Login' },
      target: {
        tag: 'input',
        name: 'password',
        accessibleName: 'Mot de passe',
        framePath: ['main'],
        shadowPath: []
      },
      value: { masked: true, secretRef: 'SECRET_PASSWORD' },
      action: {
        type: 'press',
        selector: '#pwd',
        arguments: ['p']
      }
    });
    expect(tech).toBeDefined();
    expect(tech).not.toContain('abcd1234');
    expect(tech).not.toContain('"p"');
    expect(tech).not.toContain('SECRET_PASSWORD');
    expect(tech).toContain('https://exemple.fr/login?q=ok');
  });

  it('does not clear an offline halt when Settings re-enables enrichment', async () => {
    const enriched: ChatEnrichedPayload[] = [];
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, tokensPerCall: 20 }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
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
    const budget = new FastTokenBudget({ ceiling: 10_000 });
    const agent = new ObserverAgent(
      {
        emitChat: () => undefined,
        emitEnriched: (payload) => {
          enriched.push(payload);
        },
        emitUsage: () => undefined,
        appendAgent: async () => undefined
      },
      {
        gateway,
        budget,
        windowMs: 1,
        enrichmentEnabled: () => true,
        modelName: () => 'claude-haiku-4-5-20251001'
      }
    );
    agent.onSessionStart('ses_test');
    agent.setOffline(true);
    agent.setEnabled(true);
    expect(budget.snapshot().halt).toBe('offline');
    agent.onRawEvent(click('evt_000001'));
    await agent.flush();
    expect(enriched).toHaveLength(0);
    agent.dispose();
  });

  it('re-announces rate-limit after the window auto-clears', async () => {
    const chat: ChatMessagePayload[] = [];
    let now = 1_000;
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, tokensPerCall: 10 }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
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
    const agent = new ObserverAgent(
      {
        emitChat: (message) => {
          chat.push(message);
        },
        emitEnriched: () => undefined,
        emitUsage: () => undefined,
        appendAgent: async () => undefined
      },
      {
        gateway,
        budget: new FastTokenBudget({
          ceiling: 500_000,
          rateLimitPerMin: 1,
          now: () => now
        }),
        windowMs: 1,
        enrichmentEnabled: () => true,
        modelName: () => 'claude-haiku-4-5-20251001',
        now: () => now
      }
    );
    agent.onSessionStart('ses_test');
    agent.onRawEvent(click('evt_000001'));
    await agent.flush();
    agent.onRawEvent({ ...click('evt_000002'), id: 'evt_000002' });
    await agent.flush();
    const first = chat.filter((row) => row.text.includes('appels/min'));
    expect(first).toHaveLength(1);
    expect(first[0]?.text).toContain('1 appels/min');
    now += 60_001;
    agent.onRawEvent({ ...click('evt_000003'), id: 'evt_000003' });
    await agent.flush();
    agent.onRawEvent({ ...click('evt_000004'), id: 'evt_000004' });
    await agent.flush();
    expect(chat.filter((row) => row.text.includes('appels/min'))).toHaveLength(2);
    agent.dispose();
  });

  it('clears a transient error halt when enrichment is re-enabled', () => {
    const budget = new FastTokenBudget({ ceiling: 10_000 });
    const agent = new ObserverAgent(
      {
        emitChat: () => undefined,
        emitEnriched: () => undefined,
        emitUsage: () => undefined,
        appendAgent: async () => undefined
      },
      {
        gateway: new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: {
              provider: 'anthropic',
              model: 'claude-haiku-4-5-20251001',
              baseUrl: 'https://api.anthropic.com',
              apiKey: 'sk-test',
              timeoutMs: 50
            },
            smart: {
              provider: 'anthropic',
              model: 'x',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 50
            }
          })
        }),
        budget,
        windowMs: 1,
        enrichmentEnabled: () => true,
        modelName: () => 'claude-haiku-4-5-20251001'
      }
    );
    budget.setHalt('error');
    agent.setEnabled(true);
    expect(budget.snapshot().halt).toBe('none');
    agent.configureBudget({ ceiling: 200, rateLimitPerMin: 12 });
    expect(budget.snapshot().ceiling).toBe(200);
    expect(budget.snapshot().rateLimitPerMin).toBe(12);
    agent.dispose();
  });

  it('resumes enrichment when Settings raises the ceiling above current usage', () => {
    const usage: UsagePayload[] = [];
    const budget = new FastTokenBudget({ ceiling: 100, warnRatio: 0.5 });
    budget.recordCall(80, 20);
    expect(budget.decide().reason).toBe('ceiling');
    const agent = new ObserverAgent(
      {
        emitChat: () => undefined,
        emitEnriched: () => undefined,
        emitUsage: (payload) => {
          usage.push(payload);
        },
        appendAgent: async () => undefined
      },
      {
        gateway: new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: {
              provider: 'anthropic',
              model: 'claude-haiku-4-5-20251001',
              baseUrl: 'https://api.anthropic.com',
              apiKey: 'sk-test',
              timeoutMs: 50
            },
            smart: {
              provider: 'anthropic',
              model: 'x',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 50
            }
          })
        }),
        budget,
        windowMs: 1,
        enrichmentEnabled: () => true,
        modelName: () => 'claude-haiku-4-5-20251001'
      }
    );
    const payload = agent.configureBudget({ ceiling: 500 });
    expect(payload.halt).toBe('none');
    expect(payload.ceiling).toBe(500);
    expect(budget.snapshot().halt).toBe('none');
    expect(usage.at(-1)?.halt).toBe('none');
    expect(budget.decide().decision).toBe('allow');
    agent.dispose();
  });
});
