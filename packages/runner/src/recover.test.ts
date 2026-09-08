import type { RefinedStep, Scenario } from '@spyglass/contracts';
import {
  createMockTransport,
  LlmGateway,
  observeMatchScore,
  type TransportRequest
} from '@spyglass/llm';
import { describe, expect, it } from 'vitest';
import { MemoryPageDriver } from './memory-driver.ts';
import { LlmRecoverer, StaticRecoverer } from './recover.ts';
import { runScenario } from './run.ts';

function clickStep(selector: string): RefinedStep {
  return {
    index: 0,
    intent: 'Je clique',
    action: {
      type: 'click',
      descriptor: { type: 'click', selector, selectorStrategy: 'css' }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: ['evt_000001']
  };
}

function scenarioFor(step: RefinedStep): Scenario {
  return {
    schemaVersion: 1,
    sessionId: 'ses_r',
    startUrl: 'https://exemple.test',
    steps: [step]
  };
}

function mockGateway(fail = false): LlmGateway {
  return new LlmGateway({
    transport: createMockTransport({ delayMs: 1, fail, recoverSelector: '#from-llm' }),
    profiles: () => ({
      fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
      smart: {
        provider: 'x',
        model: 'claude-sonnet-4-5-20250929',
        baseUrl: '',
        apiKey: 'mock',
        timeoutMs: 10
      }
    })
  });
}

describe('LlmRecoverer observe() R3c', () => {
  it('never binds observations[0] when the smart call fails', async () => {
    const step = clickStep('#good');
    const recoverer = new LlmRecoverer(mockGateway(true), async () => ({
      ok: true,
      observations: [{ selector: '#poison-other' }, { selector: '#good' }]
    }));
    const result = await recoverer.recover({
      scenario: scenarioFor(step),
      step,
      attempt: 1,
      error: 'selector not found',
      multimodal: false
    });
    expect(result?.descriptor.selector).toBe('#good');
    expect(result?.observeUsed).toBe(true);
    expect(result?.diagnosis).toMatch(/R3c/);
  });

  it('swallows observe() throws and still returns a smart patch', async () => {
    const step = clickStep('#broken');
    const recoverer = new LlmRecoverer(mockGateway(), async () => {
      throw new Error('stagehand down');
    });
    const result = await recoverer.recover({
      scenario: scenarioFor(step),
      step,
      attempt: 1,
      error: 'selector not found',
      multimodal: false
    });
    expect(result?.descriptor.selector).toBe('#from-llm');
    expect(result?.observeUsed).toBe(false);
  });

  it('prefers R3c observe over a successful LLM patch when score is ≥80 (L5-ADV-05 A5a)', async () => {
    let llmCalls = 0;
    const inner = createMockTransport({ delayMs: 1, recoverSelector: '#from-llm' });
    const recoverer = new LlmRecoverer(
      new LlmGateway({
        transport: {
          complete: async (request) => {
            llmCalls += 1;
            return inner.complete(request);
          }
        },
        profiles: () => ({
          fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
          smart: {
            provider: 'x',
            model: 'claude-sonnet-4-5-20250929',
            baseUrl: '',
            apiKey: 'mock',
            timeoutMs: 10
          }
        })
      }),
      async () => ({
        ok: true,
        observations: [{ selector: '#poison-other' }, { selector: 'button[data-testid="step-1"]' }]
      })
    );
    const step = clickStep('[data-testid="step-1"]');
    expect(
      observeMatchScore({ selector: 'button[data-testid="step-1"]' }, step)
    ).toBeGreaterThanOrEqual(80);
    const result = await recoverer.recover({
      scenario: scenarioFor(step),
      step,
      attempt: 1,
      error: 'selector not found',
      multimodal: false
    });
    expect(result?.descriptor.selector).toBe('button[data-testid="step-1"]');
    expect(result?.observeUsed).toBe(true);
    expect(result?.diagnosis).toMatch(/R3c/);
    expect(llmCalls).toBe(0);
  });

  it('applies the LLM patch and does not claim observeUsed when score is <80 (L5-ADV-05 A5a)', async () => {
    const step: RefinedStep = {
      ...clickStep('#broken'),
      action: {
        type: 'click',
        descriptor: {
          type: 'click',
          selector: '#broken',
          selectorStrategy: 'css',
          description: 'lien vers accueil'
        }
      }
    };
    const recoverer = new LlmRecoverer(mockGateway(), async () => ({
      ok: true,
      observations: [{ selector: '#unrelated', description: 'accueil lien vers' }]
    }));
    expect(
      observeMatchScore({ selector: '#unrelated', description: 'accueil lien vers' }, step)
    ).toBeLessThan(80);
    const result = await recoverer.recover({
      scenario: scenarioFor(step),
      step,
      attempt: 1,
      error: 'selector not found',
      multimodal: false
    });
    expect(result?.descriptor.selector).toBe('#from-llm');
    expect(result?.observeUsed).toBe(false);
    expect(result?.diagnosis).not.toMatch(/R3c/);
  });

  it('does not claim observeUsed when observe() ok but LLM patch won (L5-ADV-05 A5a)', async () => {
    const recoverer = new LlmRecoverer(mockGateway(), async () => ({
      ok: true,
      observations: [{ selector: '#unrelated' }, { selector: '#also-unrelated' }]
    }));
    const result = await recoverer.recover({
      scenario: scenarioFor(clickStep('#broken')),
      step: clickStep('#broken'),
      attempt: 1,
      error: 'selector not found',
      multimodal: false
    });
    expect(result?.descriptor.selector).toBe('#from-llm');
    expect(result?.observeUsed).toBe(false);
  });

  it('does not apply observe CSS as a navigate target when URL hash matches an id (L5-ADV-06)', async () => {
    const step: RefinedStep = {
      index: 0,
      intent: 'Je navigue',
      action: {
        type: 'navigate',
        descriptor: {
          type: 'navigate',
          selector: 'https://exemple.test/app#confirm',
          arguments: ['https://exemple.test/app#confirm']
        }
      },
      verification: {
        type: 'urlMatches',
        expected: 'https://exemple.test/ok',
        strength: 'strong',
        confirmedByUser: true
      },
      sourceEvents: ['evt_000001']
    };
    const recoverer = new LlmRecoverer(mockGateway(), async () => ({
      ok: true,
      observations: [{ selector: 'button#confirm' }]
    }));
    const result = await recoverer.recover({
      scenario: scenarioFor(step),
      step,
      attempt: 1,
      error: 'urlMatches failed',
      multimodal: false
    });
    expect(observeMatchScore({ selector: 'button#confirm' }, step)).toBeLessThan(80);
    expect(result?.observeUsed).toBe(false);
    expect(result?.descriptor.selector).not.toBe('button#confirm');
  });

  it('never sets screenshotIncluded unless image bytes are attached (L5-ADV-02)', async () => {
    const captured: TransportRequest[] = [];
    const inner = createMockTransport({ delayMs: 1, recoverSelector: '#from-llm' });
    const recoverer = new LlmRecoverer(
      new LlmGateway({
        transport: {
          complete: async (request) => {
            captured.push(request);
            return inner.complete(request);
          }
        },
        profiles: () => ({
          fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
          smart: {
            provider: 'x',
            model: 'claude-sonnet-4-5-20250929',
            baseUrl: '',
            apiKey: 'mock',
            timeoutMs: 10
          }
        })
      })
    );
    const step = clickStep('#broken');
    await recoverer.recover({
      scenario: scenarioFor(step),
      step,
      attempt: 1,
      error: 'selector not found',
      multimodal: true,
      screenshotPath: '/tmp/recover.jpg'
    });
    expect(captured).toHaveLength(1);
    const body = captured[0]?.body as { messages?: Array<{ content?: unknown }> };
    const content = body.messages?.[0]?.content;
    expect(typeof content).toBe('string');
    expect(Array.isArray(content)).toBe(false);
    if (typeof content === 'string') {
      const payload = JSON.parse(content) as { screenshotIncluded?: boolean };
      expect(payload.screenshotIncluded).toBe(false);
    }
    const serialized = JSON.stringify(captured[0]?.body);
    expect(serialized).not.toMatch(/"type":\s*"image"/);
    expect(serialized).not.toMatch(/image\/jpeg/);
  });
});

describe('recoverStep sanitizes LLM descriptors before acting (L5-ADV-01)', () => {
  it('executes a click, not an LLM navigate, when types diverge', async () => {
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [{ selector: '#go', visible: true }]
    });
    const step = clickStep('#broken');
    step.verification.expected = '#go';
    step.verification.timeoutMs = 40;
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test/start',
        steps: [step]
      },
      {
        driver,
        aiRecovery: true,
        env: {},
        recoverer: new StaticRecoverer(
          {
            type: 'navigate',
            selector: '#go',
            arguments: ['file:///etc/passwd']
          },
          'poison navigate'
        )
      }
    );
    expect(result.exitCode).toBe(0);
    expect(driver.clicks).toEqual(['#go']);
    expect(driver.urlValue).toBe('https://exemple.test/start');
  });

  it('does not load file:// from an LLM navigate patch', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/start' });
    const step: RefinedStep = {
      index: 0,
      intent: 'Je navigue',
      action: {
        type: 'navigate',
        descriptor: {
          type: 'navigate',
          selector: 'https://exemple.test/start',
          arguments: ['https://exemple.test/start']
        }
      },
      verification: {
        type: 'urlMatches',
        expected: 'https://exemple.test/ok',
        strength: 'strong',
        confirmedByUser: true,
        timeoutMs: 40
      },
      sourceEvents: ['evt_000001']
    };
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test/start',
        steps: [step]
      },
      {
        driver,
        aiRecovery: true,
        env: {},
        recoverer: new StaticRecoverer(
          {
            type: 'navigate',
            selector: 'file:///etc/passwd',
            arguments: ['file:///etc/passwd']
          },
          'poison file'
        )
      }
    );
    expect(result.exitCode).toBe(1);
    expect(driver.urlValue).toBe('https://exemple.test/start');
    expect(driver.urlValue).not.toMatch(/^file:/);
  });

  it('fails navigate recovery rather than goto https://button/ (L5-ADV-06)', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/app#confirm' });
    const step: RefinedStep = {
      index: 0,
      intent: 'Je navigue',
      action: {
        type: 'navigate',
        descriptor: {
          type: 'navigate',
          selector: 'https://exemple.test/app#confirm',
          arguments: ['https://exemple.test/app#confirm']
        }
      },
      verification: {
        type: 'urlMatches',
        expected: 'https://exemple.test/ok',
        strength: 'strong',
        confirmedByUser: true,
        timeoutMs: 40
      },
      sourceEvents: ['evt_000001']
    };
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test/app#confirm',
        steps: [step]
      },
      {
        driver,
        aiRecovery: true,
        env: {},
        recoverer: new StaticRecoverer(
          {
            type: 'navigate',
            selector: 'button#confirm',
            arguments: ['button#confirm']
          },
          'observe css'
        )
      }
    );
    expect(result.exitCode).toBe(1);
    expect(driver.urlValue).not.toMatch(/https:\/\/button/i);
    expect(driver.urlValue).not.toBe('button#confirm');
    expect(driver.urlValue).toBe('https://exemple.test/app#confirm');
  });

  it('fills the recorded value, not an LLM-injected password', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#pw', visible: true, value: '' }]
    });
    const step: RefinedStep = {
      index: 0,
      intent: 'Je saisis',
      action: {
        type: 'fill',
        descriptor: {
          type: 'fill',
          selector: '#missing',
          arguments: ['recorded-secret']
        }
      },
      verification: {
        type: 'valueEquals',
        expected: '#pw=recorded-secret',
        strength: 'strong',
        confirmedByUser: true,
        timeoutMs: 40
      },
      sourceEvents: ['evt_000001']
    };
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test',
        steps: [step]
      },
      {
        driver,
        aiRecovery: true,
        env: {},
        recoverer: new StaticRecoverer(
          { type: 'fill', selector: '#pw', arguments: ['injected-password'] },
          'inject'
        )
      }
    );
    expect(result.exitCode).toBe(0);
    expect(driver.fills).toEqual([{ selector: '#pw', value: 'recorded-secret' }]);
  });
});
