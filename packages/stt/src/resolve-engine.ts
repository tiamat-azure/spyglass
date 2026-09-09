import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SttEngine } from './engine.ts';
import { createMockEngine } from './mock-engine.ts';
import {
  parseMockTranscripts,
  type SttEngineName,
  WHISPER_TIMEOUT_MS_DEFAULT
} from './protocol.ts';
import {
  chooseWhisperModel,
  parseMaxLatencyMs,
  readLargeFallback,
  recordFirstUseLatency,
  resolveSttModelDir,
  STT_LARGE_MODEL_FILE,
  STT_SMALL_MODEL_FILE
} from './upgrade.ts';
import { createWhisperEngine, resolveWhisperPaths, whisperAvailable } from './whisper-engine.ts';

export function resolveSttEngineName(env: NodeJS.ProcessEnv = process.env): SttEngineName {
  if (env.SPYGLASS_STT_ENGINE === 'mock') {
    return 'mock';
  }
  if (env.SPYGLASS_STT_ENGINE === 'whisper') {
    return 'whisper';
  }
  return whisperAvailable(env) ? 'whisper' : 'mock';
}

export async function createEngineFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<SttEngine> {
  const name = resolveSttEngineName(env);
  if (name === 'whisper') {
    const paths = resolveWhisperPaths(env);
    if (paths === undefined) {
      throw new Error(
        'STT_ENGINE=whisper but whisper-cli and/or ggml-small-q5_1.bin are missing. Run scripts/fetch-whisper.mjs or set STT_BIN / STT_MODEL_PATH.'
      );
    }
    const language =
      env.STT_LANGUAGE === undefined || env.STT_LANGUAGE.length === 0 ? 'fr' : env.STT_LANGUAGE;
    const timeoutRaw = env.STT_MAX_LATENCY_MS;
    const timeoutMs =
      timeoutRaw === undefined || timeoutRaw.length === 0
        ? WHISPER_TIMEOUT_MS_DEFAULT
        : Number.parseInt(timeoutRaw, 10);
    const modelDir = resolveSttModelDir(env);
    let model = paths.model;
    if (modelDir !== undefined) {
      const largePath = join(modelDir, STT_LARGE_MODEL_FILE);
      const smallPath = join(modelDir, STT_SMALL_MODEL_FILE);
      const smallOk = existsSync(smallPath);
      const fallback = env.STT_LARGE_FALLBACK === '1' || (await readLargeFallback(modelDir));
      const choice = chooseWhisperModel({
        ...(existsSync(largePath) ? { largePath } : {}),
        ...(smallOk ? { smallPath } : {}),
        largeFallback: fallback
      });
      if (choice.kind === 'small') {
        model = requireSmallModelFile(smallPath, paths.model);
      } else {
        model = choice.file;
      }
      const engineOpts: Parameters<typeof createWhisperEngine>[0] = {
        bin: paths.bin,
        model,
        language,
        timeoutMs:
          Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : WHISPER_TIMEOUT_MS_DEFAULT
      };
      if (choice.kind === 'large') {
        const budgetMs = parseMaxLatencyMs(env);
        engineOpts.onFirstUseLatency = (latencyMs) => {
          void recordFirstUseLatency({ modelDir, latencyMs, budgetMs });
        };
      }
      return createWhisperEngine(engineOpts);
    }
    return createWhisperEngine({
      bin: paths.bin,
      model,
      language,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : WHISPER_TIMEOUT_MS_DEFAULT
    });
  }
  return createMockEngine(parseMockTranscripts(env.SPYGLASS_STT_MOCK_TRANSCRIPTS));
}

/**
 * L7-016: large-model fallback must load `ggml-small-q5_1.bin`, never the large weights.
 */
export function requireSmallModelFile(smallPath: string, refusedPath: string): string {
  if (existsSync(smallPath) && basename(smallPath) === STT_SMALL_MODEL_FILE) {
    return smallPath;
  }
  throw new Error(
    `STT large-model fallback requires ${STT_SMALL_MODEL_FILE} at ${smallPath} (refusing to use ${basename(refusedPath)} as the small engine)`
  );
}
