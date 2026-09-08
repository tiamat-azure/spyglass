import type { Scenario } from '@spyglass/contracts';
import { createMockTransport, LlmGateway, parseRecoverResponse } from '@spyglass/llm';
import { describe, expect, it } from 'vitest';

const scenario: Scenario = {
  schemaVersion: 1,
  sessionId: 'ses_r',
  startUrl: 'https://exemple.test',
  steps: [
    {
      index: 0,
      intent: 'Je clique',
      action: {
        type: 'click',
        descriptor: { type: 'click', selector: '#broken', fallbackSelectors: ['#good'] }
      },
      verification: {
        type: 'elementVisible',
        expected: '#good',
        strength: 'strong',
        confirmedByUser: true
      },
      sourceEvents: ['evt_000001']
    }
  ]
};

describe('smart recovery prompt contract', () => {
  it('rejects a verification-scope patch in code (F-62)', () => {
    const parsed = parseRecoverResponse(
      JSON.stringify({
        diagnosis: 'assertion changed',
        patch: { scope: 'verification', descriptor: { type: 'click', selector: '#x' } },
        confidence: 1
      })
    );
    expect(parsed).toEqual({
      error: 'rejected patch scope (F-62 invariant: action.descriptor only)'
    });
  });

  it('returns an action.descriptor patch from the mock smart transport', async () => {
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, recoverSelector: '#recovered' }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'x',
          baseUrl: '',
          apiKey: '',
          timeoutMs: 50
        },
        smart: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          baseUrl: '',
          apiKey: 'mock',
          timeoutMs: 50
        }
      })
    });
    const step = scenario.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) {
      return;
    }
    const result = await gateway.recover({
      scenario,
      step,
      error: 'selector not found',
      attempt: 1,
      screenshotIncluded: false
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.patch.scope).toBe('action.descriptor');
      expect(result.proposal.patch.descriptor.selector).toBe('#recovered');
    }
  });

  it('does not treat a public startUrl host as an expurgation leak', async () => {
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, recoverSelector: '#recovered' }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: 'x',
          baseUrl: '',
          apiKey: '',
          timeoutMs: 50
        },
        smart: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          baseUrl: '',
          apiKey: 'mock',
          timeoutMs: 50
        }
      })
    });
    const step = scenario.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) {
      return;
    }
    const result = await gateway.recover({
      scenario,
      step,
      error: 'Cannot find selector #broken-selector after 3 attempts',
      attempt: 1,
      screenshotIncluded: false
    });
    expect(result.ok).toBe(true);
  });

  it('strips LLM fill arguments and ungated navigate URLs (L5-ADV-01)', () => {
    const fill = parseRecoverResponse(
      JSON.stringify({
        diagnosis: 'retry fill',
        patch: {
          scope: 'action.descriptor',
          descriptor: {
            type: 'fill',
            selector: '#pw',
            arguments: ['injected-password']
          }
        },
        confidence: 1
      })
    );
    expect('error' in fill).toBe(false);
    if (!('error' in fill)) {
      expect(fill.patch.descriptor.arguments).toBeUndefined();
      expect(fill.patch.descriptor.selector).toBe('#pw');
    }

    const jsNav = parseRecoverResponse(
      JSON.stringify({
        diagnosis: 'go elsewhere',
        patch: {
          scope: 'action.descriptor',
          descriptor: {
            type: 'navigate',
            selector: 'javascript:alert(1)',
            arguments: ['javascript:alert(1)']
          }
        },
        confidence: 1
      })
    );
    expect('error' in jsNav).toBe(false);
    if (!('error' in jsNav)) {
      expect(jsNav.patch.descriptor.arguments).toBeUndefined();
      expect(jsNav.patch.descriptor.selector).toBe('javascript:alert(1)');
    }

    const cssNav = parseRecoverResponse(
      JSON.stringify({
        diagnosis: 'click it',
        patch: {
          scope: 'action.descriptor',
          descriptor: {
            type: 'navigate',
            selector: 'button#confirm',
            arguments: ['button#confirm']
          }
        },
        confidence: 1
      })
    );
    expect('error' in cssNav).toBe(false);
    if (!('error' in cssNav)) {
      expect(cssNav.patch.descriptor.arguments).toBeUndefined();
      expect(cssNav.patch.descriptor.selector).toBe('button#confirm');
      expect(JSON.stringify(cssNav)).not.toMatch(/https:\/\/button/i);
    }

    const httpsNav = parseRecoverResponse(
      JSON.stringify({
        diagnosis: 'open next page',
        patch: {
          scope: 'action.descriptor',
          descriptor: {
            type: 'navigate',
            selector: 'https://exemple.test/next',
            arguments: ['https://exemple.test/next']
          }
        },
        confidence: 1
      })
    );
    expect('error' in httpsNav).toBe(false);
    if (!('error' in httpsNav)) {
      expect(httpsNav.patch.descriptor.arguments).toEqual(['https://exemple.test/next']);
    }
  });
});
