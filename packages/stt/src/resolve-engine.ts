import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { SttEngine } from './engine.ts';
import { createMockEngine } from './mock-engine.ts';
import { parseMockTranscripts, parseWhisperTimeoutMs, type SttEngineName } from './protocol.ts';
import {
  chooseWhisperModel,
  largeFallbackMarkerDirs,
  parseMaxLatencyMs,
  readLargeFallback,
  readLargeFallbackSync,
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

type WhisperPathsResolved = NonNullable<ReturnType<typeof resolveWhisperPaths>>;

type WhisperModelSelection = {
  modelDir: string;
  largePath: string;
  smallPath: string;
  smallOk: boolean;
  explicit: string | undefined;
  explicitOk: boolean;
  largeOk: boolean;
  explicitIsConventional: boolean;
  envForcedSmall: boolean;
  explicitCustomPath: boolean;
  paths: WhisperPathsResolved;
};

type WhisperBuildContext = {
  paths: WhisperPathsResolved;
  language: string;
  timeoutMs: number;
  modelDir: string;
  selection: WhisperModelSelection;
};

/**
 * A17b: synchronous engine factory (`SttEngine`, not `Promise<SttEngine>`).
 * Whisper reads `large-fallback.json` with sync I/O (F16b). Callers that
 * should not block the event loop use {@link createEngineFromEnvAsync}.
 */
export function createEngineFromEnv(env: NodeJS.ProcessEnv = process.env): SttEngine {
  if (resolveSttEngineName(env) !== 'whisper') {
    return createMockEngine(parseMockTranscripts(env.SPYGLASS_STT_MOCK_TRANSCRIPTS));
  }
  const begun = beginWhisperFromEnv(env);
  if (isReadyEngine(begun)) {
    return begun;
  }
  const fallback = needsLargeFallbackMarker(begun.selection)
    ? readAlignedLargeFallbackSync(env, begun)
    : begun.selection.envForcedSmall;
  return finishWhisperFromEnv(env, begun, fallback);
}

/**
 * A17b: async companion. Same selection as {@link createEngineFromEnv} but
 * awaits {@link readLargeFallback} for the marker.
 */
export async function createEngineFromEnvAsync(
  env: NodeJS.ProcessEnv = process.env
): Promise<SttEngine> {
  if (resolveSttEngineName(env) !== 'whisper') {
    return createMockEngine(parseMockTranscripts(env.SPYGLASS_STT_MOCK_TRANSCRIPTS));
  }
  const begun = beginWhisperFromEnv(env);
  if (isReadyEngine(begun)) {
    return begun;
  }
  const fallback = needsLargeFallbackMarker(begun.selection)
    ? await readAlignedLargeFallback(env, begun)
    : begun.selection.envForcedSmall;
  return finishWhisperFromEnv(env, begun, fallback);
}

function isReadyEngine(value: SttEngine | WhisperBuildContext): value is SttEngine {
  return 'name' in value && 'begin' in value;
}

function beginWhisperFromEnv(env: NodeJS.ProcessEnv): SttEngine | WhisperBuildContext {
  const paths = resolveWhisperPaths(env);
  if (paths === undefined) {
    throw new Error(
      `STT_ENGINE=whisper but whisper-cli and/or ${STT_SMALL_MODEL_FILE} are missing. Run scripts/fetch-whisper.mjs or set STT_BIN / STT_MODEL_PATH.`
    );
  }
  const language =
    env.STT_LANGUAGE === undefined || env.STT_LANGUAGE.length === 0 ? 'fr' : env.STT_LANGUAGE;
  const timeoutMs = parseWhisperTimeoutMs(env);
  const modelDir = resolveSttModelDir(env) ?? dirname(paths.model);
  return {
    paths,
    language,
    timeoutMs,
    modelDir,
    selection: collectModelSelection(env, paths, modelDir)
  };
}

function finishWhisperFromEnv(
  env: NodeJS.ProcessEnv,
  ctx: WhisperBuildContext,
  fallback: boolean
): SttEngine {
  const model = selectWhisperModel(ctx.selection, fallback);
  const engineOpts: Parameters<typeof createWhisperEngine>[0] = {
    bin: ctx.paths.bin,
    model,
    language: ctx.language,
    timeoutMs: ctx.timeoutMs
  };
  // F28b / F-39: attach the large→small safety net whenever the selected
  // file is the large model (basename), including STT_MODEL_PATH copies
  // outside join(modelDir, STT_LARGE_MODEL_FILE).
  if (basename(model) === STT_LARGE_MODEL_FILE) {
    const budgetMs = parseMaxLatencyMs(env);
    engineOpts.onFirstUseLatency = async (latencyMs) => {
      await recordFirstUseLatency({ modelDir: ctx.modelDir, latencyMs, budgetMs });
    };
  }
  return createWhisperEngine(engineOpts);
}

function collectModelSelection(
  env: NodeJS.ProcessEnv,
  paths: WhisperPathsResolved,
  modelDir: string
): WhisperModelSelection {
  const largePath = join(modelDir, STT_LARGE_MODEL_FILE);
  const smallPath = join(modelDir, STT_SMALL_MODEL_FILE);
  const smallOk = existsSync(smallPath);
  const explicit = env.STT_MODEL_PATH?.trim();
  const explicitOk = explicit !== undefined && explicit.length > 0 && existsSync(explicit);
  const largeOk = existsSync(largePath);
  const explicitIsConventional =
    (smallOk && explicit !== undefined && sameResolvedPath(explicit, smallPath)) ||
    (largeOk && explicit !== undefined && sameResolvedPath(explicit, largePath));
  const envForcedSmall = env.STT_LARGE_FALLBACK === '1';
  const explicitCustomPath = explicitOk && !explicitIsConventional;
  return {
    modelDir,
    largePath,
    smallPath,
    smallOk,
    explicit,
    explicitOk,
    largeOk,
    explicitIsConventional,
    envForcedSmall,
    explicitCustomPath,
    paths
  };
}

/** F16b: fail-loud on corrupt/unreadable large-fallback.json only when large could be selected. */
function needsLargeFallbackMarker(selection: WhisperModelSelection): boolean {
  // L7-218: a missing STT_MODEL_PATH whose basename is large is not selectable.
  const explicitIsLargeFile =
    selection.explicitOk &&
    selection.explicit !== undefined &&
    basename(selection.explicit) === STT_LARGE_MODEL_FILE;
  const largeCouldBeSelected = selection.largeOk || explicitIsLargeFile;
  const customNonLarge = selection.explicitCustomPath && !explicitIsLargeFile;
  return largeCouldBeSelected && !selection.envForcedSmall && !customNonLarge;
}

/** L7-209: same marker dirs as F23b (`STT_MODEL_DIR` and `STT_MODEL_PATH` dirname). */
function alignedFallbackMarkerDirs(env: NodeJS.ProcessEnv, ctx: WhisperBuildContext): string[] {
  const extra = [ctx.paths.model, ctx.selection.largePath];
  if (ctx.selection.explicit !== undefined && ctx.selection.explicit.length > 0) {
    extra.push(ctx.selection.explicit);
  }
  return largeFallbackMarkerDirs(env, extra);
}

function readAlignedLargeFallbackSync(env: NodeJS.ProcessEnv, ctx: WhisperBuildContext): boolean {
  for (const dir of alignedFallbackMarkerDirs(env, ctx)) {
    if (readLargeFallbackSync(dir)) {
      return true;
    }
  }
  return false;
}

async function readAlignedLargeFallback(
  env: NodeJS.ProcessEnv,
  ctx: WhisperBuildContext
): Promise<boolean> {
  for (const dir of alignedFallbackMarkerDirs(env, ctx)) {
    if (await readLargeFallback(dir)) {
      return true;
    }
  }
  return false;
}

function selectWhisperModel(selection: WhisperModelSelection, fallback: boolean): string {
  if (selection.explicitOk && !fallback && !selection.explicitIsConventional) {
    // P6a / M4a: honor STT_MODEL_PATH over STT_MODEL_DIR conventional
    // small/large discovery. F3a still prefers large when fallback is
    // false and the explicit path is the conventional small in MODEL_DIR.
    // L7-016 still refuses large weights as the small engine when fallback.
    return selection.explicit as string;
  }
  const choice = chooseWhisperModel({
    ...(selection.largeOk ? { largePath: selection.largePath } : {}),
    ...(selection.smallOk ? { smallPath: selection.smallPath } : {}),
    largeFallback: fallback,
    modelDir: selection.modelDir
  });
  if (choice.kind === 'small') {
    // L7-096: fallback must load the conventional small file, never a
    // custom STT_MODEL_PATH that merely is not named like the large file.
    // M4a/P6a still honour explicit path on the non-fallback branch above.
    return requireSmallModelFile(
      selection.smallPath,
      selection.explicitOk && selection.explicit !== undefined
        ? selection.explicit
        : selection.paths.model
    );
  }
  return choice.file;
}

/** L7-132: treat `dir/./file` and `dir/file` as the same model path. */
function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
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
