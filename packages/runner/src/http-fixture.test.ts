import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNNER_FIXTURES_DIR, resolveFixtureHtmlPath, startFixtureServer } from './http-fixture.ts';

describe('fixture HTML paths (L6-025)', () => {
  it('resolves lot6-fixture.html under the fixtures dir and rejects traversal', () => {
    const fixturesRoot = resolve(RUNNER_FIXTURES_DIR);
    expect(resolveFixtureHtmlPath('/lot6-fixture.html')).toBe(
      resolve(fixturesRoot, 'lot6-fixture.html')
    );
    expect(resolveFixtureHtmlPath('/../package.json')).toBeUndefined();
    expect(resolveFixtureHtmlPath('/../../app/resources/lot1-fixture.html')).toBeUndefined();
    expect(resolveFixtureHtmlPath('/%2e%2e/lot6-fixture.html')).toBeUndefined();
    expect(resolveFixtureHtmlPath('..\\..\\lot1-fixture.html')).toBeUndefined();
    const doubled = resolveFixtureHtmlPath('//etc/passwd.html');
    expect(doubled).not.toBe('/etc/passwd.html');
    if (doubled !== undefined) {
      expect(doubled.startsWith(fixturesRoot)).toBe(true);
    }
  });

  it('404s escaped HTML over HTTP', async () => {
    const server = await startFixtureServer();
    try {
      const ok = await fetch(`${server.origin}/lot6-fixture.html`);
      expect(ok.status).toBe(200);
      const missing = await fetch(`${server.origin}/no-such-fixture.html`);
      expect(missing.status).toBe(404);
      const traversal = await fetch(`${server.origin}/../../app/resources/lot1-fixture.html`);
      expect(traversal.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
