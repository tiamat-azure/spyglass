import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseVoiceFlushMs,
  parseWhisperTimeoutMs,
  VOICE_FLUSH_MS,
  WHISPER_TIMEOUT_MS_DEFAULT
} from './protocol.ts';
import {
  createEngineFromEnv,
  createEngineFromEnvAsync,
  requireSmallModelFile,
  resolveSttEngineName
} from './resolve-engine.ts';
import {
  chooseWhisperModel,
  isLargeFallbackError,
  LARGE_FALLBACK_ERROR_TAG,
  largeFallbackMarkerDirs,
  largeModelPresent,
  parseMaxLatencyMs,
  parseUpgradePromptAfter,
  readLargeFallback,
  readLargeFallbackSync,
  recordFirstUseLatency,
  resolveSttModelDir,
  STT_FALLBACK_MARKER,
  STT_LARGE_MODEL_FILE,
  STT_LARGE_SHA256,
  STT_MAX_LATENCY_MS_DEFAULT,
  STT_SMALL_MODEL_FILE,
  shouldProposeUpgrade,
  writeLargeFallback
} from './upgrade.ts';
import { whisperAvailable } from './whisper-engine.ts';

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

  it('prefers large when present and within budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-up-large-'));
    const largePath = join(dir, STT_LARGE_MODEL_FILE);
    await writeFile(largePath, 'stub-large-weights\n', 'utf8');
    const choice = chooseWhisperModel({
      largePath,
      smallPath: join(dir, STT_SMALL_MODEL_FILE),
      largeFallback: false
    });
    expect(choice.kind).toBe('large');
    expect(choice.file).toBe(largePath);
    expect(choice.file).toContain('large-v3-turbo');
  });

  it('does not treat a directory as a present large model (L7-261)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-up-dirlarge-'));
    const largePath = join(dir, STT_LARGE_MODEL_FILE);
    const smallPath = join(dir, STT_SMALL_MODEL_FILE);
    await mkdir(largePath, { recursive: true });
    await writeFile(smallPath, 'stub-small-weights\n', 'utf8');
    const choice = chooseWhisperModel({
      largePath,
      smallPath,
      largeFallback: false
    });
    expect(choice.kind).toBe('small');
    expect(choice.file).toBe(smallPath);
    expect(largeModelPresent(dir)).toBe(false);
    const src = await readFile(new URL('./upgrade.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export function chooseWhisperModel');
    const end = src.indexOf('export function shouldFallbackToSmall');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('isExistingRegularFile');
    expect(body).not.toContain('existsSync');
    const presentStart = src.indexOf('export function largeModelPresent');
    const presentEnd = src.indexOf('export async function recordFirstUseLatency');
    expect(presentStart).toBeGreaterThan(-1);
    expect(presentEnd).toBeGreaterThan(presentStart);
    const present = src.slice(presentStart, presentEnd);
    expect(present).toContain('isExistingRegularFile');
    expect(present).not.toContain('existsSync');
  });

  it('does not return a missing largePath (L7-239)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-up-nolarge-'));
    const smallPath = join(dir, STT_SMALL_MODEL_FILE);
    await writeFile(smallPath, 'stub-small-weights\n', 'utf8');
    const choice = chooseWhisperModel({
      largePath: join(dir, STT_LARGE_MODEL_FILE),
      smallPath,
      largeFallback: false
    });
    expect(choice.kind).toBe('small');
    expect(choice.file).toBe(smallPath);
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

  it('splits whisper-cli timeout from first-use latency budget (L27b)', () => {
    expect(parseWhisperTimeoutMs({})).toBe(WHISPER_TIMEOUT_MS_DEFAULT);
    expect(parseWhisperTimeoutMs({ STT_WHISPER_TIMEOUT_MS: '40000' })).toBe(40_000);
    expect(parseWhisperTimeoutMs({ STT_MAX_LATENCY_MS: '1500' })).toBe(WHISPER_TIMEOUT_MS_DEFAULT);
    expect(parseWhisperTimeoutMs({ STT_WHISPER_TIMEOUT_MS: '0' })).toBe(WHISPER_TIMEOUT_MS_DEFAULT);
    expect(parseWhisperTimeoutMs({ STT_WHISPER_TIMEOUT_MS: 'nope' })).toBe(
      WHISPER_TIMEOUT_MS_DEFAULT
    );
    expect(parseMaxLatencyMs({})).toBe(STT_MAX_LATENCY_MS_DEFAULT);
    expect(parseMaxLatencyMs({ STT_MAX_LATENCY_MS: '1500' })).toBe(1500);
    expect(parseMaxLatencyMs({ STT_WHISPER_TIMEOUT_MS: '40000' })).toBe(STT_MAX_LATENCY_MS_DEFAULT);
    expect(
      parseWhisperTimeoutMs({ STT_WHISPER_TIMEOUT_MS: '40000', STT_MAX_LATENCY_MS: '1500' })
    ).toBe(40_000);
    expect(parseMaxLatencyMs({ STT_WHISPER_TIMEOUT_MS: '40000', STT_MAX_LATENCY_MS: '1500' })).toBe(
      1500
    );
    expect(parseVoiceFlushMs({})).toBe(VOICE_FLUSH_MS);
    expect(parseVoiceFlushMs({ STT_WHISPER_TIMEOUT_MS: '40000' })).toBe(42_000);
    expect(parseVoiceFlushMs({ STT_WHISPER_TIMEOUT_MS: '40000' })).toBeGreaterThanOrEqual(
      parseWhisperTimeoutMs({ STT_WHISPER_TIMEOUT_MS: '40000' })
    );
    expect(parseVoiceFlushMs({ STT_WHISPER_TIMEOUT_MS: '40000', STT_MAX_LATENCY_MS: '1500' })).toBe(
      42_000
    );
  });
});

describe('Lot 7 STT small-engine fallback (L7-016)', () => {
  it('createEngineFromEnv is synchronous and is not a Promise (A17b)', () => {
    const engine = createEngineFromEnv({ SPYGLASS_STT_ENGINE: 'mock' });
    expect(engine).not.toBeInstanceOf(Promise);
    expect(engine.name).toBe('mock');
  });

  it('createEngineFromEnvAsync is the named async factory (A17b)', async () => {
    const pending = createEngineFromEnvAsync({ SPYGLASS_STT_ENGINE: 'mock' });
    expect(pending).toBeInstanceOf(Promise);
    const engine = await pending;
    expect(engine.name).toBe('mock');
  });

  it('refuses to use the large weights as the small engine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-small-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    expect(() =>
      createEngineFromEnv({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli'),
        STT_MODEL_PATH: join(dir, STT_LARGE_MODEL_FILE),
        STT_LARGE_FALLBACK: '1'
      })
    ).toThrow(/ggml-small-q5_1\.bin/);
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
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
    });
    expect(engine).not.toBeInstanceOf(Promise);
    expect(engine.model).toBe(join(dir, STT_LARGE_MODEL_FILE));
  });

  it('treats a missing large-fallback.json as false (L7-042)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-fb-miss-'));
    expect(await readLargeFallback(dir)).toBe(false);
    expect(readLargeFallbackSync(dir)).toBe(false);
  });

  it('throws on corrupt large-fallback.json (L7-042)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-fb-bad-'));
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    await expect(readLargeFallback(dir)).rejects.toThrow(/corrupt large-fallback.json/);
    expect(() => readLargeFallbackSync(dir)).toThrow(/corrupt large-fallback.json/);
    try {
      readLargeFallbackSync(dir);
      expect.unreachable();
    } catch (error) {
      expect(isLargeFallbackError(error)).toBe(true);
      if (isLargeFallbackError(error)) {
        expect(error.kind).toBe('corrupt');
        expect(error.tag).toBe(LARGE_FALLBACK_ERROR_TAG);
      }
    }
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
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
    });
    expect(engine.model).toBe(join(dir, STT_SMALL_MODEL_FILE));
  });

  it('does not treat a missing STT_MODEL_PATH large as selectable (L7-218)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7218-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: join(dir, STT_LARGE_MODEL_FILE)
    });
    expect(engine.model).toBe(join(dir, STT_SMALL_MODEL_FILE));
    const src = await readFile(new URL('./resolve-engine.ts', import.meta.url), 'utf8');
    const fn = src.slice(
      src.indexOf('function needsLargeFallbackMarker'),
      src.indexOf('function alignedFallbackMarkerDirs')
    );
    expect(fn).toContain('selection.explicitOk');
  });

  it('fails loud on corrupt large-fallback.json when large would be selected (F16b)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-f16b-large-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    expect(() =>
      createEngineFromEnv({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli'),
        STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
      })
    ).toThrow(/corrupt large-fallback.json/);
    await expect(
      createEngineFromEnvAsync({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli'),
        STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
      })
    ).rejects.toThrow(/corrupt large-fallback.json/);
  });

  it('does not let whisperAvailable auto-select mock past F16b fail-loud (L7-176)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7176-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(join(dir, STT_FALLBACK_MARKER), '{not json', 'utf8');
    const env = {
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli')
    };
    expect(whisperAvailable(env)).toBe(true);
    expect(resolveSttEngineName(env)).toBe('whisper');
    expect(() => createEngineFromEnv(env)).toThrow(/corrupt large-fallback.json/);
    const resourcesOnly = {
      SPYGLASS_STT_RESOURCES: dir,
      STT_BIN: join(dir, 'whisper-cli')
    };
    expect(whisperAvailable(resourcesOnly)).toBe(true);
    expect(() => createEngineFromEnv(resourcesOnly)).toThrow(/corrupt large-fallback.json/);
  });

  it('does not report whisper available when prefer-small leaves no model (L7-215)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7215-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    const env = {
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_LARGE_FALLBACK: '1'
    };
    expect(whisperAvailable(env)).toBe(false);
    expect(resolveSttEngineName(env)).toBe('mock');
  });

  it('fails loud on unreadable large-fallback.json when large would be selected (F16b / I26a)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-i26a-unreadable-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await mkdir(join(dir, STT_FALLBACK_MARKER));
    expect(() =>
      createEngineFromEnv({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli')
      })
    ).toThrow(/unreadable large-fallback.json/);
    await expect(
      createEngineFromEnvAsync({
        SPYGLASS_STT_ENGINE: 'whisper',
        STT_MODEL_DIR: dir,
        STT_BIN: join(dir, 'whisper-cli')
      })
    ).rejects.toThrow(/unreadable large-fallback.json/);
  });

  it('ignores an unreadable large-fallback.json on a small-only setup (F16b / I26a)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-i26a-small-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await mkdir(join(dir, STT_FALLBACK_MARKER));
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: join(dir, STT_SMALL_MODEL_FILE)
    });
    expect(engine.model).toBe(join(dir, STT_SMALL_MODEL_FILE));
  });

  it('honours an explicit custom STT_MODEL_PATH filename (M4a)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-custom-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    const custom = join(dir, 'custom-weights.bin');
    await writeFile(custom, 'weights\n', 'utf8');
    const engine = createEngineFromEnv({
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
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: modelDir,
      STT_BIN: join(modelDir, 'whisper-cli'),
      STT_MODEL_PATH: explicit
    });
    expect(engine.model).toBe(explicit);
  });

  it('attaches first-use latency for STT_MODEL_PATH large outside modelDir (F28b)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stt-f28b-'));
    const modelDir = join(root, 'dir');
    const other = join(root, 'other');
    await mkdir(modelDir, { recursive: true });
    await mkdir(other, { recursive: true });
    const bin = await writeWhisperCliStub(modelDir);
    await writeFile(join(modelDir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    const explicit = join(other, STT_LARGE_MODEL_FILE);
    await writeFile(explicit, 'large-weights\n', 'utf8');
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: modelDir,
      STT_BIN: bin,
      STT_MODEL_PATH: explicit,
      STT_MAX_LATENCY_MS: '1'
    });
    expect(engine.model).toBe(explicit);
    engine.begin('u1');
    engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
    await engine.finalize('u1');
    const marker = join(modelDir, STT_FALLBACK_MARKER);
    const deadline = Date.now() + 4000;
    let raw = '';
    while (Date.now() < deadline) {
      try {
        raw = await readFile(marker, 'utf8');
        break;
      } catch {
        await new Promise((resolve) => {
          setTimeout(resolve, 50);
        });
      }
    }
    expect(raw).toMatch(/"fallback":\s*true/);
  });

  it('does not gate first-use latency on join(modelDir, STT_LARGE) (F28b)', async () => {
    const src = await readFile(new URL('./resolve-engine.ts', import.meta.url), 'utf8');
    const start = src.indexOf('function finishWhisperFromEnv');
    const end = src.indexOf('function collectModelSelection');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('onFirstUseLatency');
    expect(body).toContain('basename(model) === STT_LARGE_MODEL_FILE');
    expect(body).not.toContain('sameResolvedPath(model, ctx.selection.largePath)');
    expect(body).not.toContain('ctx.selection.largeOk &&');
  });

  it('honours large-fallback.json beside STT_MODEL_PATH even when STT_MODEL_DIR differs (L7-209)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7209-'));
    const modelDir = join(root, 'dir');
    const other = join(root, 'other');
    await mkdir(modelDir, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(join(modelDir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(modelDir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    await writeFile(join(modelDir, STT_LARGE_MODEL_FILE), 'dir-large\n', 'utf8');
    const explicit = join(other, STT_LARGE_MODEL_FILE);
    await writeFile(explicit, 'other-large\n', 'utf8');
    await writeFile(join(other, STT_FALLBACK_MARKER), `${JSON.stringify({ fallback: true })}\n`);
    const env = {
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: modelDir,
      STT_BIN: join(modelDir, 'whisper-cli'),
      STT_MODEL_PATH: explicit
    };
    const engine = createEngineFromEnv(env);
    expect(engine.model).toBe(join(modelDir, STT_SMALL_MODEL_FILE));
    await expect(createEngineFromEnvAsync(env)).resolves.toMatchObject({
      model: join(modelDir, STT_SMALL_MODEL_FILE)
    });
  });

  it('does not load a custom STT_MODEL_PATH on large→small fallback (L7-096)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7096-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    const custom = join(dir, 'custom-weights.bin');
    await writeFile(custom, 'not-small\n', 'utf8');
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: custom,
      STT_LARGE_FALLBACK: '1'
    });
    expect(engine.model).toBe(join(dir, STT_SMALL_MODEL_FILE));
    expect(engine.model).not.toBe(custom);
  });

  it('does not requireSmallModelFile on a non-fallback resolved model (L7-300)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7300-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    const custom = join(dir, 'custom-weights.bin');
    await writeFile(custom, 'usable-small\n', 'utf8');
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_FILE: 'custom-weights.bin'
    });
    expect(engine.model).toBe(custom);
    const viaPath = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_MODEL_DIR: dir,
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: custom
    });
    expect(viaPath.model).toBe(custom);
    const src = await readFile(new URL('./resolve-engine.ts', import.meta.url), 'utf8');
    const start = src.indexOf('function selectWhisperModel');
    const end = src.indexOf('function sameResolvedPath');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body.indexOf('if (fallback)')).toBeGreaterThan(-1);
    expect(body.indexOf('requireSmallModelFile')).toBeGreaterThan(body.indexOf('if (fallback)'));
    expect(body.indexOf('requireSmallModelFile')).toBeLessThan(
      body.indexOf('isExistingRegularFile(choice.file)')
    );
  });

  it('treats syntactic path variants as the conventional large/small files (L7-132)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7132-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    await writeFile(join(dir, STT_LARGE_MODEL_FILE), 'large-weights\n', 'utf8');
    await writeFile(join(dir, STT_SMALL_MODEL_FILE), 'small-weights\n', 'utf8');
    const dottedSmall = join(dir, '.', STT_SMALL_MODEL_FILE);
    const engine = createEngineFromEnv({
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

  it('trims STT_MODEL_PATH before dirname (L7-201)', () => {
    expect(resolveSttModelDir({ STT_MODEL_PATH: ' /opt/whisper/ggml-small-q5_1.bin ' })).toBe(
      '/opt/whisper'
    );
  });

  it('trims padded STT_MODEL_PATH before resolveWhisperPaths (L7-291)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7291-'));
    await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n', { encoding: 'utf8' });
    const small = join(dir, STT_SMALL_MODEL_FILE);
    await writeFile(small, 'small-weights\n', 'utf8');
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_PATH: ` ${small} `
    });
    expect(engine.model).toBe(small);
    const viaDir = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'whisper',
      STT_BIN: join(dir, 'whisper-cli'),
      STT_MODEL_DIR: ` ${dir} `
    });
    expect(viaDir.model).toBe(small);
    const src = await readFile(new URL('./resolve-engine.ts', import.meta.url), 'utf8');
    const start = src.indexOf('function beginWhisperFromEnv');
    const end = src.indexOf('function finishWhisperFromEnv');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body.indexOf('envWithTrimmedSttModelPaths')).toBeGreaterThan(-1);
    expect(body.indexOf('resolveWhisperPaths(normalized)')).toBeGreaterThan(
      body.indexOf('envWithTrimmedSttModelPaths')
    );
  });

  it('lists STT_MODEL_DIR and STT_MODEL_PATH dirname for fallback markers (L7-209)', () => {
    expect(
      largeFallbackMarkerDirs({ STT_MODEL_DIR: '/models' }, ['/other/ggml-large-v3-turbo-q5_0.bin'])
    ).toEqual(['/models', '/other']);
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
    const resolveStart = src.indexOf('export function resolveWhisperPaths');
    const resolveEnd = src.indexOf('export function pickPreferredWhisperModel');
    expect(resolveStart).toBeGreaterThan(-1);
    const resolveBody = src.slice(resolveStart, resolveEnd);
    expect(resolveBody).toContain('isExistingRegularFile');
  });

  it('returns the parsed fallback boolean directly (L7-157)', async () => {
    const src = await readFile(new URL('./upgrade.ts', import.meta.url), 'utf8');
    const start = src.indexOf('function parseLargeFallbackJson');
    const end = src.indexOf('export async function readLargeFallback');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('return fallback;');
    expect(body).not.toContain('return fallback === true');
  });

  it('measures first-use latency with a monotonic clock (L7-164)', async () => {
    const src = await readFile(new URL('./whisper-engine.ts', import.meta.url), 'utf8');
    const start = src.indexOf('const transcribe = async');
    const end = src.indexOf("return {\n    name: 'whisper'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('performance.now()');
    expect(body).not.toContain('Date.now()');
  });

  it('pins the known large-model SHA-256 (S4a)', () => {
    expect(STT_LARGE_SHA256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('uses regular-file checks in collectModelSelection / requireSmallModelFile (L7-268)', async () => {
    const src = await readFile(new URL('./resolve-engine.ts', import.meta.url), 'utf8');
    const collectStart = src.indexOf('function collectModelSelection');
    const collectEnd = src.indexOf('function needsLargeFallbackMarker');
    expect(collectStart).toBeGreaterThan(-1);
    expect(collectEnd).toBeGreaterThan(collectStart);
    const collect = src.slice(collectStart, collectEnd);
    expect(collect).toContain('isExistingRegularFile');
    expect(collect).not.toContain('existsSync');
    const requireStart = src.indexOf('export function requireSmallModelFile');
    expect(requireStart).toBeGreaterThan(-1);
    const requireFn = src.slice(requireStart);
    expect(requireFn).toContain('isExistingRegularFile');
    expect(requireFn).not.toContain('existsSync');
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7268-'));
    const smallPath = join(dir, STT_SMALL_MODEL_FILE);
    await mkdir(smallPath, { recursive: true });
    expect(() => requireSmallModelFile(smallPath, 'refused.bin')).toThrow(
      /STT large-model fallback requires/
    );
  });
});

async function writeWhisperCliStub(dir: string): Promise<string> {
  const bin = join(dir, 'whisper-cli.cjs');
  const lines = [
    "'use strict';",
    "const { writeFileSync } = require('node:fs');",
    'const argv = process.argv.slice(2);',
    "let out = '';",
    'for (let i = 0; i < argv.length; i += 1) {',
    "  if (argv[i] === '-of' && argv[i + 1] !== undefined) {",
    '    out = argv[i + 1];',
    '    i += 1;',
    '  }',
    '}',
    "const text = 'transcription locale\\n';",
    'if (out.length > 0) {',
    "  writeFileSync(out + '.txt', text);",
    '}',
    'process.stdout.write(text);'
  ];
  await writeFile(bin, `${lines.join('\n')}\n`);
  return bin;
}
