import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { applyBaseUrl } from './base-url.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import { runScenario } from './run.ts';

describe('applyBaseUrl (L6-002)', () => {
  it('resolves a relative startUrl against the base (WHATWG)', () => {
    expect(applyBaseUrl('https://staging.test/preview/', 'login')).toBe(
      'https://staging.test/preview/login'
    );
    expect(applyBaseUrl('https://staging.test/preview/', '/login')).toBe(
      'https://staging.test/login'
    );
  });

  it('rewrites the origin of an absolute http(s) startUrl', () => {
    expect(applyBaseUrl('https://staging.test', 'https://prod.test/login')).toBe(
      'https://staging.test/login'
    );
    expect(applyBaseUrl('https://staging.test/', 'https://prod.test/login?next=1#ok')).toBe(
      'https://staging.test/login?next=1#ok'
    );
    expect(new URL('https://prod.test/login', 'https://staging.test/').href).toBe(
      'https://prod.test/login'
    );
  });

  it('prefixes a non-root base pathname onto an absolute start path', () => {
    expect(applyBaseUrl('https://staging.test/preview/', 'https://prod.test/login')).toBe(
      'https://staging.test/preview/login'
    );
    expect(applyBaseUrl('https://staging.test/preview', 'https://prod.test/app/home')).toBe(
      'https://staging.test/preview/app/home'
    );
  });

  it('leaves a file: startUrl unchanged against an http(s) base', () => {
    expect(applyBaseUrl('https://staging.test/', 'file:///tmp/page.html')).toBe(
      'file:///tmp/page.html'
    );
  });

  it('returns startUrl when --base-url is omitted', () => {
    expect(applyBaseUrl(undefined, 'https://prod.test/login')).toBe('https://prod.test/login');
    expect(applyBaseUrl('', '/relative')).toBe('/relative');
  });

  it('does not append slash onto query or hash of --base-url (L6-032)', () => {
    expect(applyBaseUrl('https://staging.test/preview?x=1', 'login')).toBe(
      'https://staging.test/preview/login'
    );
    expect(applyBaseUrl('https://staging.test/preview?x=1', 'https://prod.test/login')).toBe(
      'https://staging.test/preview/login'
    );
    expect(applyBaseUrl('https://staging.test/preview#frag', 'login')).toBe(
      'https://staging.test/preview/login'
    );
  });

  it('runScenario goto uses the rewritten absolute startUrl', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#go', visible: true }]
    });
    const step: RefinedStep = {
      index: 0,
      intent: 'Je clique',
      action: {
        type: 'click',
        descriptor: {
          type: 'click',
          selector: '#go',
          selectorStrategy: 'css'
        }
      },
      verification: {
        type: 'elementVisible',
        expected: '#go',
        strength: 'strong',
        confirmedByUser: true
      },
      sourceEvents: ['evt_000001']
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_l6_002',
      startUrl: 'https://prod.test/login',
      steps: [step]
    };
    const result = await runScenario(scenario, {
      driver,
      aiRecovery: false,
      env: {},
      baseUrl: 'https://staging.test/preview/'
    });
    expect(result.exitCode).toBe(0);
    expect(driver.urlValue).toBe('https://staging.test/preview/login');
  });
});
