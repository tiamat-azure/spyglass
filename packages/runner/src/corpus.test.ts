import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { LOCAL_CORPUS_SIZE, localCorpusSites, measureCorpus, PUBLIC_CORPUS } from './corpus.ts';
import { resolveCorpusOutPath, runCorpusCli } from './corpus-cli.ts';
import { startFixtureServer } from './http-fixture.ts';

describe('Lot 6 measurement protocol corpus', () => {
  it('defines 10 public sites and 10 local protocol pages', () => {
    expect(PUBLIC_CORPUS).toHaveLength(10);
    expect(new Set(PUBLIC_CORPUS.map((site) => site.id)).size).toBe(10);
    expect(LOCAL_CORPUS_SIZE).toBe(10);
    const origin = 'http://127.0.0.1:9';
    expect(localCorpusSites(origin)).toHaveLength(10);
  });

  it('measures 10/10 --no-ai on the immutable local corpus (CI mockable, no keys)', async () => {
    const server = await startFixtureServer();
    const reportRoot = await mkdtemp(join(tmpdir(), 'spyglass-lot6-corpus-'));
    try {
      const measured = await measureCorpus({
        sites: localCorpusSites(server.origin),
        wave: 'local-immutable',
        reportRoot,
        env: { ...process.env, CI: '1', SPYGLASS_NO_SANDBOX: '1', SPYGLASS_DISABLE_GPU: '1' },
        headless: true,
        timeoutMs: 12_000
      });
      expect(measured.sites).toHaveLength(10);
      expect(measured.aiRecovery).toBe(false);
      expect(measured.replayWithoutAiRate).toBe(1);
      expect(measured.sites.every((row) => row.ok && row.mode === 'script')).toBe(true);
    } finally {
      await server.close();
    }
  }, 120_000);

  it('defaults --j1 output to measured-rates.j1.json and does not clobber J+0 (L6-006)', () => {
    expect(resolveCorpusOutPath([], 'J+1')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.j1.json')
    );
    expect(resolveCorpusOutPath(['--public', '--j1'], 'J+1')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.j1.json')
    );
    expect(resolveCorpusOutPath(['--public'], 'J+0')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.json')
    );
    expect(resolveCorpusOutPath([], 'local-immutable')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.json')
    );
    expect(resolveCorpusOutPath(['--out', '/tmp/custom-j1.json'], 'J+1')).toBe(
      resolve('/tmp/custom-j1.json')
    );
  });

  it('measure-corpus script uses --experimental-transform-types (L6-007)', async () => {
    const pkg = JSON.parse(
      await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['measure-corpus']).toContain('--experimental-transform-types');
  });

  it('refuses --j1 without --public (L6-012)', async () => {
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await runCorpusCli(['--j1'])).toBe(2);
      expect(chunks.join('')).toMatch(/--j1 requires --public/);
    } finally {
      process.stderr.write = write;
    }
  });
});
