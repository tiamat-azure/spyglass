import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { createMockTransport, LlmGateway } from '@spyglass/llm';
import { describe, expect, it } from 'vitest';
import { LlmRecoverer } from './recover.ts';

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
});
