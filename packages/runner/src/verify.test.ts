import { describe, expect, it } from 'vitest';
import { MemoryPageDriver } from './memory-driver.ts';
import { isDegenerateUrlPattern, verifyStep } from './verify.ts';

describe('urlMatches (L5-ADV-03)', () => {
  it('rejects empty, star-only, and globstar-only patterns', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/app/page' });
    const patterns = ['', '*', '**', '***', '  *  '];
    for (const expected of patterns) {
      const result = await verifyStep(
        driver,
        {
          index: 0,
          intent: 'nav',
          action: { type: 'navigate', descriptor: { type: 'navigate', selector: expected } },
          verification: {
            type: 'urlMatches',
            expected,
            strength: 'strong',
            confirmedByUser: true,
            timeoutMs: 1
          },
          sourceEvents: ['evt_000001']
        },
        1
      );
      expect(result.ok, expected).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/degenerate|urlMatches/i);
      }
    }
  });

  it('does not treat stripped wildcards as includes("") always-true', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/login' });
    const result = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'https://x' } },
        verification: {
          type: 'urlMatches',
          expected: '*',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(result.ok).toBe(false);
  });

  it('matches a real glob and an exact URL only via glob, not substring', async () => {
    const driver = new MemoryPageDriver({
      url: 'file:///workspace/packages/app/out/resources/lot1-fixture.html'
    });
    const globOk = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'x' } },
        verification: {
          type: 'urlMatches',
          expected: '**/lot1-fixture.html',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(globOk.ok).toBe(true);
    const substring = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'x' } },
        verification: {
          type: 'urlMatches',
          expected: 'lot1-fixture',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(substring.ok).toBe(false);
  });

  it('does not treat */* or a hostname substring as a match', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/login' });
    const starSlash = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'x' } },
        verification: {
          type: 'urlMatches',
          expected: '*/*',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(starSlash.ok).toBe(false);
    const host = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'x' } },
        verification: {
          type: 'urlMatches',
          expected: 'exemple.test',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(host.ok).toBe(false);
  });

  it('rejects near-universal globs (L5-ADV-03b)', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/app/page' });
    const patterns = ['**/*', '**/**', '*/*/*', '**/*.*', '  **/*  '];
    for (const expected of patterns) {
      const result = await verifyStep(
        driver,
        {
          index: 0,
          intent: 'nav',
          action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'x' } },
          verification: {
            type: 'urlMatches',
            expected,
            strength: 'strong',
            confirmedByUser: true,
            timeoutMs: 1
          },
          sourceEvents: ['evt_000001']
        },
        1
      );
      expect(result.ok, expected).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/degenerate|urlMatches/i);
      }
    }
  });

  it('flags **/* family as degenerate without matching a specific fixture glob', () => {
    expect(isDegenerateUrlPattern('**/*')).toBe(true);
    expect(isDegenerateUrlPattern('**/**')).toBe(true);
    expect(isDegenerateUrlPattern('*/*')).toBe(true);
    expect(isDegenerateUrlPattern('**/lot1-fixture.html')).toBe(false);
    expect(isDegenerateUrlPattern('https://exemple.test/**')).toBe(false);
  });

  it('matches an exact URL that includes a query string (L5-ADV-03c)', async () => {
    const url = 'https://exemple.test/login?next=/app';
    const driver = new MemoryPageDriver({ url });
    const result = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: url } },
        verification: {
          type: 'urlMatches',
          expected: url,
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(result.ok).toBe(true);
    const noQuery = await verifyStep(
      driver,
      {
        index: 0,
        intent: 'nav',
        action: { type: 'navigate', descriptor: { type: 'navigate', selector: url } },
        verification: {
          type: 'urlMatches',
          expected: 'https://exemple.test/login',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 1
        },
        sourceEvents: ['evt_000001']
      },
      1
    );
    expect(noQuery.ok).toBe(false);
  });

  it('does not throw on awkward patterns such as ?* (L5-ADV-03c)', async () => {
    const driver = new MemoryPageDriver({ url: 'https://exemple.test/login?next=/app' });
    const patterns = ['?*', '*?', '???', '(', '['];
    for (const expected of patterns) {
      await expect(
        verifyStep(
          driver,
          {
            index: 0,
            intent: 'nav',
            action: { type: 'navigate', descriptor: { type: 'navigate', selector: 'x' } },
            verification: {
              type: 'urlMatches',
              expected,
              strength: 'strong',
              confirmedByUser: true,
              timeoutMs: 1
            },
            sourceEvents: ['evt_000001']
          },
          1
        )
      ).resolves.toMatchObject({ ok: false });
    }
  });
});
