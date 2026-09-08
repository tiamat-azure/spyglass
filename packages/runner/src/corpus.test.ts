import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_CORPUS_SIZE, localCorpusSites, measureCorpus, PUBLIC_CORPUS } from './corpus.ts';
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
});
