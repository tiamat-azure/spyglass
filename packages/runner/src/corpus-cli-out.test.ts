import { access, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from '@spyglass/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { onMeasure } = vi.hoisted(() => ({
  onMeasure: vi.fn(async () => undefined)
}));

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
    measureCorpus: async () => {
      await onMeasure();
      return {
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
      };
    }
  };
});

import { runCorpusCli } from './corpus-cli.ts';

describe('corpus-cli nested --out (L6-040 / L6-075)', () => {
  const nestedRoot = join(repoRoot(), 'docs/lot-6/corpus-runs', 'l6-040-nested-out');
  const toctouDir = join(repoRoot(), 'docs/lot-6/corpus-runs', 'l6-075-toctou');

  afterEach(async () => {
    onMeasure.mockReset();
    onMeasure.mockImplementation(async () => undefined);
    await rm(nestedRoot, { recursive: true, force: true });
    await rm(toctouDir, { recursive: true, force: true });
  });

  it('mkdirs parent directories before writeFile', async () => {
    const out = join(nestedRoot, 'wave', 'rates.json');
    expect(await runCorpusCli(['--out', out])).toBe(0);
    const written = JSON.parse(await readFile(out, 'utf8')) as { replayWithoutAiRate: number };
    expect(written.replayWithoutAiRate).toBe(1);
  });

  it('rejects --out when a missing ancestor becomes an escaping symlink (L6-075)', async () => {
    const out = join(toctouDir, 'rates.json');
    const outside = await mkdtemp(join(tmpdir(), 'spyglass-l6-075-'));
    onMeasure.mockImplementation(async () => {
      await mkdir(join(repoRoot(), 'docs/lot-6/corpus-runs'), { recursive: true });
      await rm(toctouDir, { recursive: true, force: true });
      await symlink(outside, toctouDir);
    });
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await runCorpusCli(['--out', out])).toBe(1);
      expect(chunks.join('')).toMatch(/escapes|changed after validation/);
      await expect(access(join(outside, 'rates.json'))).rejects.toThrow();
    } finally {
      process.stderr.write = write;
      await rm(outside, { recursive: true, force: true });
    }
  });
});
