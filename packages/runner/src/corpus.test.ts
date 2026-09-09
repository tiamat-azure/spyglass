import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import {
  corpusWaveMode,
  LOCAL_CORPUS_SIZE,
  localCorpusSites,
  measureCorpus,
  PUBLIC_CORPUS
} from './corpus.ts';
import { resolveCorpusOutPath, runCorpusCli } from './corpus-cli.ts';
import { startFixtureServer } from './http-fixture.ts';

describe('Lot 6 measurement protocol corpus', () => {
  it('aggregates step modes so no-AI success is exit 0 and all script (L6-038)', () => {
    expect(corpusWaveMode([])).toBe('none');
    expect(corpusWaveMode([{ mode: 'script' }, { mode: 'script' }])).toBe('script');
    expect(corpusWaveMode([{ mode: 'script' }, { mode: 'AI' }])).toBe('AI');
    expect(corpusWaveMode([{ mode: 'AI' }, { mode: 'script' }])).toBe('AI');
    expect(corpusWaveMode([{ mode: 'script' }, {}])).toBe('none');
    expect(corpusWaveMode([{ mode: 'AI' }, {}])).toBe('none');
    expect(corpusWaveMode([{}])).toBe('none');
  });

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

  it('defaults local --out to measured-rates.local.json and does not clobber J+0 (L6-006 / L6-013)', async () => {
    expect(await resolveCorpusOutPath([], 'J+1')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.j1.json')
    );
    expect(await resolveCorpusOutPath(['--public', '--j1'], 'J+1')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.j1.json')
    );
    expect(await resolveCorpusOutPath(['--public'], 'J+0')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.json')
    );
    expect(await resolveCorpusOutPath([], 'local-immutable')).toBe(
      resolve(repoRoot(), 'docs/lot-6/measured-rates.local.json')
    );
    expect(await resolveCorpusOutPath(['--out', 'docs/lot-6/custom-j1.json'], 'J+1')).toBe(
      resolve(repoRoot(), 'docs/lot-6/custom-j1.json')
    );
    await expect(resolveCorpusOutPath(['--out', '/tmp/custom-j1.json'], 'J+1')).rejects.toThrow(
      /escapes the repo/
    );
    await expect(
      resolveCorpusOutPath(['--out', resolve(repoRoot(), '..', 'spyglass-out-escape.json')], 'J+0')
    ).rejects.toThrow(/escapes the repo/);
    await expect(
      resolveCorpusOutPath(['--out', resolve(repoRoot(), 'README.md')], 'J+0')
    ).rejects.toThrow(/escapes docs\/lot-6/);
    await expect(
      resolveCorpusOutPath(['--out', resolve(repoRoot(), 'docs/lot-6/notes.md')], 'J+0')
    ).rejects.toThrow(/must be a \.json file/);
  });

  it('resolves relative --out from repoRoot not cwd (L6-058)', async () => {
    const relativeOut = 'docs/lot-6/filter-cwd.json';
    const fromRoot = resolve(repoRoot(), relativeOut);
    const fromFilterCwd = resolve(join(repoRoot(), 'packages/runner'), relativeOut);
    expect(fromFilterCwd).not.toBe(fromRoot);
    expect(await resolveCorpusOutPath(['--out', relativeOut], 'J+1')).toBe(fromRoot);
    expect(await resolveCorpusOutPath(['--out', fromRoot], 'J+1')).toBe(fromRoot);
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), 'corpus-cli.ts'),
      'utf8'
    );
    expect(src).toContain('resolve(repoRoot(), outArg)');
    expect(src).toContain('isAbsolute(outArg)');
    expect(src).not.toMatch(/resolve\(process\.cwd\(\)/);
    expect(src).not.toContain('process.chdir');
  });

  it('O34a jail realpaths symlink parents that point outside the repo (L6-047)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'spyglass-out-escape-'));
    const link = join(repoRoot(), 'docs/lot-6/corpus-runs', 'l6-047-symlink');
    await mkdir(dirname(link), { recursive: true });
    await rm(link, { recursive: true, force: true });
    await symlink(outside, link);
    try {
      await expect(
        resolveCorpusOutPath(['--out', join(link, 'rates.json')], 'J+0')
      ).rejects.toThrow(/escapes/);
    } finally {
      await rm(link, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('O34a jail errors are stderr+exit 1 for programmatic callers (L6-045)', async () => {
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await runCorpusCli(['--out', '/tmp/custom-j1.json'])).toBe(1);
      expect(chunks.join('')).toMatch(/escapes the repo/);
    } finally {
      process.stderr.write = write;
    }
  });

  it('refuses --out without a path instead of defaulting (L6-049)', async () => {
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await runCorpusCli(['--out'])).toBe(2);
      expect(await runCorpusCli(['--out', '--public'])).toBe(2);
      expect(chunks.join('')).toMatch(/--out requires a path/);
    } finally {
      process.stderr.write = write;
    }
  });

  it('corpus-cli mkdir parent dirs before writeFile (L6-040)', async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), 'corpus-cli.ts'),
      'utf8'
    );
    expect(src).toContain('mkdir(dirname(out), { recursive: true })');
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
