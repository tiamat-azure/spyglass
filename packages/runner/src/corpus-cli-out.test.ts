import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '@spyglass/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./http-fixture.ts', () => ({
  startFixtureServer: async () => ({
    origin: 'http://127.0.0.1:9',
    close: async () => undefined
  })
}));

vi.mock('./corpus.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./corpus.ts')>();
  return {
    ...actual,
    measureCorpus: async () => ({
      schemaVersion: 1,
      protocol: 'prd-2.2-jplus1',
      measuredAt: '2026-09-08T00:00:00.000Z',
      wave: 'local-immutable',
      headless: true,
      aiRecovery: false,
      sites: [],
      replayWithoutAiRate: 1,
      replayWithAiRate: null,
      notes: []
    })
  };
});

import { runCorpusCli } from './corpus-cli.ts';

describe('corpus-cli nested --out (L6-040)', () => {
  const nestedRoot = join(repoRoot(), 'docs/lot-6/corpus-runs', 'l6-040-nested-out');

  afterEach(async () => {
    await rm(nestedRoot, { recursive: true, force: true });
  });

  it('mkdirs parent directories before writeFile', async () => {
    const out = join(nestedRoot, 'wave', 'rates.json');
    expect(await runCorpusCli(['--out', out])).toBe(0);
    const written = JSON.parse(await readFile(out, 'utf8')) as { replayWithoutAiRate: number };
    expect(written.replayWithoutAiRate).toBe(1);
  });
});
