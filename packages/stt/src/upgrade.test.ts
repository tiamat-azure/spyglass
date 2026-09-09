import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngineFromEnv } from './resolve-engine.ts';
import {
  chooseWhisperModel,
  parseUpgradePromptAfter,
  recordFirstUseLatency,
  STT_LARGE_MODEL_FILE,
  STT_SMALL_MODEL_FILE,
  shouldProposeUpgrade
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
});
