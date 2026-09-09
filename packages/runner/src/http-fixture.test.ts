import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RUNNER_FIXTURES_DIR,
  rawPathHasEncodedDots,
  resolveFixtureHtmlPath,
  startFixtureServer
} from './http-fixture.ts';

function rawGetStatus(origin: string, path: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const url = new URL(origin);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: 'GET',
        timeout: 3000
      },
      (res) => {
        res.resume();
        resolveStatus(res.statusCode ?? 0);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`request timed out: ${path}`));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('fixture HTML paths (L6-025)', () => {
  it('resolves lot6-fixture.html under the fixtures dir and rejects traversal', () => {
    const fixturesRoot = resolve(RUNNER_FIXTURES_DIR);
    expect(resolveFixtureHtmlPath('/lot6-fixture.html')).toBe(
      resolve(fixturesRoot, 'lot6-fixture.html')
    );
    expect(resolveFixtureHtmlPath('/../package.json')).toBeUndefined();
    expect(resolveFixtureHtmlPath('/../../app/resources/lot1-fixture.html')).toBeUndefined();
    expect(resolveFixtureHtmlPath('/%2e%2e/lot6-fixture.html')).toBeUndefined();
    expect(resolveFixtureHtmlPath('/%2E/lot6-fixture.html')).toBeUndefined();
    expect(resolveFixtureHtmlPath('..\\..\\lot1-fixture.html')).toBeUndefined();
    const doubled = resolveFixtureHtmlPath('//etc/passwd.html');
    expect(doubled).not.toBe('/etc/passwd.html');
    if (doubled !== undefined) {
      expect(doubled.startsWith(fixturesRoot)).toBe(true);
    }
  });

  it('rejects encoded dot segments before URL normalization (L6-054)', () => {
    expect(rawPathHasEncodedDots('/%2e%2e/lot6-fixture.html')).toBe(true);
    expect(rawPathHasEncodedDots('/%2E/lot6-fixture.html')).toBe(true);
    expect(rawPathHasEncodedDots('/foo/%2e%2e/bar.html')).toBe(true);
    expect(rawPathHasEncodedDots('/lot6-fixture.html')).toBe(false);
    expect(rawPathHasEncodedDots('/lot6-fixture.html?x=%2e%2e')).toBe(false);
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
      expect(await rawGetStatus(server.origin, '/%2e%2e/lot6-fixture.html')).toBe(404);
      expect(await rawGetStatus(server.origin, '/%2e/lot6-fixture.html')).toBe(404);
      expect(await rawGetStatus(server.origin, '/%2E%2E/lot6-fixture.html')).toBe(404);
      const queryDots = await fetch(`${server.origin}/lot6-fixture.html?x=%2e%2e`);
      expect(queryDots.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('responds 500 when handle rejects so clients do not hang (L6-067)', async () => {
    const server = await startFixtureServer();
    try {
      expect(await rawGetStatus(server.origin, 'http://[')).toBe(500);
      expect(await rawGetStatus(server.origin, 'http://[::1')).toBe(500);
      const src = await readFile(
        join(dirname(fileURLToPath(import.meta.url)), 'http-fixture.ts'),
        'utf8'
      );
      expect(src).toContain('.catch(() => {');
      expect(src).toContain("send(response, 500, 'text/plain; charset=utf-8', 'internal error')");
    } finally {
      await server.close();
    }
  });
});
