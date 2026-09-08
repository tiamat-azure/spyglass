import type { SttEngine } from './engine.ts';
import { createMockEngine } from './mock-engine.ts';
import {
  parseMockTranscripts,
  type SttEngineName,
  WHISPER_TIMEOUT_MS_DEFAULT
} from './protocol.ts';
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

export function createEngineFromEnv(env: NodeJS.ProcessEnv = process.env): SttEngine {
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
