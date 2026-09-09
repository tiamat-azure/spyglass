import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Quantized large-v3-turbo (~575 Mo). Optional after install (ADR-0017). */
export const STT_LARGE_MODEL_FILE = 'ggml-large-v3-turbo-q5_0.bin';
export const STT_SMALL_MODEL_FILE = 'ggml-small-q5_1.bin';
export const STT_LARGE_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin';

export const STT_UPGRADE_PROMPT_AFTER_DEFAULT = 10;
export const STT_MAX_LATENCY_MS_DEFAULT = 2_000;
export const STT_FALLBACK_MARKER = 'large-fallback.json';

export type SttUpgradeDecision = 'propose' | 'silent' | 'refused';

export type SttModelChoice = {
  file: string;
  kind: 'small' | 'large';
  fallback: boolean;
};

export function parseUpgradePromptAfter(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STT_UPGRADE_PROMPT_AFTER;
  if (raw === undefined || raw.trim().length === 0) {
    return STT_UPGRADE_PROMPT_AFTER_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : STT_UPGRADE_PROMPT_AFTER_DEFAULT;
}

export function parseMaxLatencyMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STT_MAX_LATENCY_MS;
  if (raw === undefined || raw.trim().length === 0) {
    return STT_MAX_LATENCY_MS_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : STT_MAX_LATENCY_MS_DEFAULT;
}

/**
 * F-38: propose large-v3-turbo after N manual transcript corrections.
 * The proposal is refusible permanently.
 */
export function shouldProposeUpgrade(input: {
  correctionCount: number;
  refusedPermanently: boolean;
  largeAvailable: boolean;
  after?: number;
}): SttUpgradeDecision {
  if (input.refusedPermanently) {
    return 'refused';
  }
  if (input.largeAvailable) {
    return 'silent';
  }
  const after = input.after ?? STT_UPGRADE_PROMPT_AFTER_DEFAULT;
  return input.correctionCount >= after ? 'propose' : 'silent';
}

/**
 * F-39: small is never deleted. Prefer large only when present and first-use
 * latency stayed within budget; otherwise fall back to small.
 */
export function chooseWhisperModel(input: {
  largePath?: string;
  smallPath?: string;
  largeFallback: boolean;
}): SttModelChoice {
  if (input.largePath !== undefined && input.largePath.length > 0 && !input.largeFallback) {
    return { file: input.largePath, kind: 'large', fallback: false };
  }
  if (input.smallPath !== undefined && input.smallPath.length > 0) {
    return { file: input.smallPath, kind: 'small', fallback: input.largeFallback };
  }
  return { file: STT_SMALL_MODEL_FILE, kind: 'small', fallback: input.largeFallback };
}

export function shouldFallbackToSmall(latencyMs: number, budgetMs: number): boolean {
  return latencyMs > budgetMs;
}

export async function readLargeFallback(modelDir: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(join(modelDir, STT_FALLBACK_MARKER), 'utf8')) as {
      fallback?: unknown;
    };
    return raw.fallback === true;
  } catch {
    return false;
  }
}

export async function writeLargeFallback(modelDir: string, fallback: boolean): Promise<void> {
  await mkdir(modelDir, { recursive: true });
  await writeFile(
    join(modelDir, STT_FALLBACK_MARKER),
    `${JSON.stringify({ fallback, at: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
}

export function largeModelPath(modelDir: string): string {
  return join(modelDir, STT_LARGE_MODEL_FILE);
}

export function smallModelPath(modelDir: string): string {
  return join(modelDir, STT_SMALL_MODEL_FILE);
}

export function largeModelPresent(modelDir: string): boolean {
  return existsSync(largeModelPath(modelDir));
}

export async function recordFirstUseLatency(input: {
  modelDir: string;
  latencyMs: number;
  budgetMs: number;
}): Promise<{ fallback: boolean }> {
  if (!shouldFallbackToSmall(input.latencyMs, input.budgetMs)) {
    return { fallback: false };
  }
  await writeLargeFallback(input.modelDir, true);
  return { fallback: true };
}

export function resolveSttModelDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.STT_MODEL_DIR;
  if (dir !== undefined && dir.trim().length > 0) {
    return dir;
  }
  const explicit = env.STT_MODEL_PATH;
  if (explicit !== undefined && explicit.trim().length > 0) {
    return dirname(explicit);
  }
  return undefined;
}
