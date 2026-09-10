import type { SttEngine } from './engine.ts';
import { createMockEngine } from './mock-engine.ts';
import {
  parseMockTranscripts,
  type SttEngineName,
  WHISPER_TIMEOUT_MS_DEFAULT
} from './protocol.ts';
import { createWhisperEngine, resolveWhisperPaths, whisperAvailable } from './whisper-engine.ts';

/**
 * The engine could not be built. Carries a stable `code` so the Electron main
 * process can turn it into an end-user message instead of leaking a path list.
 */
export class SttEngineUnavailableError extends Error {
  readonly code = 'stt-engine-unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'SttEngineUnavailableError';
  }
}

/**
 * The mock engine emits canned transcripts. Reaching it from a real session
 * would look like a working dictation while ignoring the microphone, so it is
 * only ever selected when explicitly asked for (`SPYGLASS_STT_ENGINE=mock`) or
 * under a test runner.
 */
export function mockEngineAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === 'true' || env.NODE_ENV === 'test' || env.VITEST !== undefined;
}

export function resolveSttEngineName(env: NodeJS.ProcessEnv = process.env): SttEngineName {
  if (env.SPYGLASS_STT_ENGINE === 'mock') {
    return 'mock';
  }
  if (env.SPYGLASS_STT_ENGINE === 'whisper') {
    return 'whisper';
  }
  if (whisperAvailable(env)) {
    return 'whisper';
  }
  return mockEngineAllowed(env) ? 'mock' : 'whisper';
}

/** Human-readable reason why dictation cannot start, or `undefined` when it can. */
export function sttEngineUnavailableReason(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (resolveSttEngineName(env) === 'mock' || whisperAvailable(env)) {
    return undefined;
  }
  return 'whisper-cli and/or ggml-small-q5_1.bin are missing. Run `node scripts/fetch-whisper.mjs`, or set STT_BIN / STT_MODEL_PATH.';
}

export function createEngineFromEnv(env: NodeJS.ProcessEnv = process.env): SttEngine {
  const name = resolveSttEngineName(env);
  if (name === 'whisper') {
    const paths = resolveWhisperPaths(env);
    if (paths === undefined) {
      throw new SttEngineUnavailableError(
        `Local STT engine unavailable: ${sttEngineUnavailableReason(env) ?? 'whisper binaries are missing.'}`
      );
    }
    const language =
      env.STT_LANGUAGE === undefined || env.STT_LANGUAGE.length === 0 ? 'fr' : env.STT_LANGUAGE;
    const timeoutRaw = env.STT_MAX_LATENCY_MS;
    const timeoutMs =
      timeoutRaw === undefined || timeoutRaw.length === 0
        ? WHISPER_TIMEOUT_MS_DEFAULT
        : Number.parseInt(timeoutRaw, 10);
    return createWhisperEngine({
      bin: paths.bin,
      model: paths.model,
      language,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : WHISPER_TIMEOUT_MS_DEFAULT
    });
  }
  return createMockEngine(parseMockTranscripts(env.SPYGLASS_STT_MOCK_TRANSCRIPTS));
}
