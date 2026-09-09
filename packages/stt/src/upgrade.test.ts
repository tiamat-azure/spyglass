import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngineFromEnv } from './resolve-engine.ts';
import {
  chooseWhisperModel,
  parseUpgradePromptAfter,
  readLargeFallback,
  recordFirstUseLatency,
  resolveSttModelDir,
  STT_FALLBACK_MARKER,
  STT_LARGE_MODEL_FILE,
  STT_LARGE_SHA256,
  STT_SMALL_MODEL_FILE,
  shouldProposeUpgrade,
  writeLargeFallback
} from './upgrade.ts';

describe('Lot 7 STT precision upgrade (F-38 / F-39 / ADR-0017)', () => {
  it('proposes large-v3-turbo after N manual corrections', () => {
    expect(
      shouldProposeUpgrade({
        correctionCount: 9,
        refusedPermanently: false,
        largeAvailable: false,
        after: 10
      })
    ).toBe('silent');
    expect(
      shouldProposeUpgrade({
        correctionCount: 10,
        refusedPermanently: false,
        largeAvailable: false,
        after: 10
      })
    ).toBe('propose');
  });

  it('honours a permanent refusal', () => {
    expect(
      shouldProposeUpgrade({
        correctionCount: 99,
        refusedPermanently: true,
        largeAvailable: false
      })
    ).toBe('refused');
  });

  it('keeps small as fallback when large exceeds the latency budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-up-'));
    await mkdir(dir, { recursive: true });
    const first = await recordFirstUseLatency({ modelDir: dir, latencyMs: 3500, budgetMs: 2000 });
    expect(first.fallback).toBe(true);
    const choice = chooseWhisperModel({
      largePath: join(dir, STT_LARGE_MODEL_FILE),
      smallPath: join(dir, STT_SMALL_MODEL_FILE),
      largeFallback: true
    });
    expect(choice.kind).toBe('small');
    expect(choice.fallback).toBe(true);
  });

  it('prefers large when present and within budget', () => {
    const choice = chooseWhisperModel({
      largePath: `/models/${STT_LARGE_MODEL_FILE}`,
      smallPath: `/models/${STT_SMALL_MODEL_FILE}`,
      largeFallback: false
    });
    expect(choice.kind).toBe('large');
    expect(choice.file).toContain('large-v3-turbo');
  });

  it('returns smallModelPath when smallPath is omitted (L7-073)', () => {
    const choice = chooseWhisperModel({
      largeFallback: true,
      modelDir: '/opt/whisper'
    });
    expect(choice.kind).toBe('small');
    expect(choice.file).toBe(join('/opt/whisper', STT_SMALL_MODEL_FILE));
    expect(choice.file).not.toBe(STT_SMALL_MODEL_FILE);
  });

  it('reads STT_UPGRADE_PROMPT_AFTER', () => {
    expect(parseUpgradePromptAfter({ STT_UPGRADE_PROMPT_AFTER: '3' })).toBe(3);
    expect(parseUpgradePromptAfter({})).toBe(10);
  });
});

describe('Lot 7 STT small-engine fallback (L7-016)', () => {
  it('refuses to use the large weights as the small engine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-small-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await expect(
      createEngineFromEnv({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli'),
        STT_MODEL_PATH: join(dir, STT_LARGE_MODEL_FILE),
        STT_LARGE_FALLBACK: '1'
      })
    ).rejects.toThrow(/ggml-small-q5_1\.bin/);
  });

  it('honours fallback: false in large-fallback.json (F3a)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-f3a-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(
      join(dir, STT_FALLBACK_MARKER),
      `${JSON.stringify({ fallback: false })}\n`,
      'utf8'
    );
    const engine = await createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
    });
    expect(engine.model).toBe(join(dir, STT_LARGE_MODEL_FILE));
  });

  it('treats a missing large-fallback.json as false (L7-042)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-fb-miss-'));
    expect(await readLargeFallback(dir)).toBe(false);
  });

  it('throws on corrupt large-fallback.json (L7-042)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-fb-bad-'));
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    await expect(readLargeFallback(dir)).rejects.toThrow(/corrupt large-fallback.json/);
  });

  it('replaces a corrupt large-fallback.json atomically (L7-140)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7140-'));
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    await writeLargeFallback(dir, true);
    expect(await readLargeFallback(dir)).toBe(true);
  });

  it('ignores a corrupt large-fallback.json on a small-only setup (F16b)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-f16b-small-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    const engine = await createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
    });
    expect(engine.model).toBe(join(dir, STT_SMALL_MODEL_FILE));
  });

  it('fails loud on corrupt large-fallback.json when large would be selected (F16b)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-f16b-large-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    await expect(
      createEngineFromEnv({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli'),
        STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
      })
    ).rejects.toThrow(/corrupt large-fallback.json/);
  });

  it('honours an explicit custom STT_MODEL_PATH filename (M4a)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-custom-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    const custom = join(dir, 'custom-weights.bin');
    await writeFile(custom, 'weights\n', 'utf8');
    const engine = await createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: custom
    });
    expect(engine.model).toBe(custom);
  });

  it('honours STT_MODEL_PATH over STT_MODEL_DIR conventional small (P6a)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stt-p6a-'));
    const modelDir = join(root, 'dir');
    const other = join(root, 'other');
    await mkdir(modelDir, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(join(modelDir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(modelDir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    const explicit = join(other, STT_LARGE_MODEL_FILE);
    await writeFile(explicit, 'large-weights\n', 'utf8');
    const engine = await createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: modelDir,
      STT_BIN: join(modelDir, 'whisper-cli'),
      STT_MODEL_PATH: explicit
    });
    expect(engine.model).toBe(explicit);
  });

  it('does not load a custom STT_MODEL_PATH on large→small fallback (L7-096)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7096-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    const custom = join(dir, 'custom-weights.bin');
    await writeFile(custom, 'not-small\n', 'utf8');
    const engine = await createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: custom,
      STT_LARGE_FALLBACK: '1'
    });
    expect(engine.model).toBe(join(dir, STT_SMALL_MODEL_FILE));
    expect(engine.model).not.toBe(custom);
  });

  it('treats syntactic path variants as the conventional large/small files (L7-132)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7132-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    const dottedSmall = join(dir, '.', STT_SMALL_MODEL_FILE);
    const engine = await createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: dottedSmall
    });
    expect(engine.model).toBe(join(dir, STT_LARGE_MODEL_FILE));
  });

  it('trims STT_MODEL_DIR (L7-133)', () => {
    expect(resolveSttModelDir({ STT_MODEL_DIR: ' /opt/whisper ' })).toBe('/opt/whisper');
  });

  it('lists large model candidates via STT_LARGE_MODEL_FILE (L7-156)', async () => {
    const src = await readFile(new URL('./whisper-engine.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export function whisperCandidateModels');
    const end = src.indexOf('export function resolveWhisperPaths');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('STT_LARGE_MODEL_FILE');
    expect(body.match(/ggml-large-v3-turbo-q5_0\.bin/g) ?? []).toEqual([]);
  });

  it('returns the parsed fallback boolean directly (L7-157)', async () => {
    const src = await readFile(new URL('./upgrade.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function readLargeFallback');
    const end = src.indexOf('export async function writeLargeFallback');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('return fallback;');
    expect(body).not.toContain('return fallback === true');
  });

  it('pins the known large-model SHA-256 (S4a)', () => {
    expect(STT_LARGE_SHA256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
