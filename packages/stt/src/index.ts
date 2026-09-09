/**
 * Local STT sidecar (Lot 3). whisper.cpp is the packaged/dev engine (ADR-0013);
 * CI uses the mock engine when binaries/models are absent.
 */
export const STT_PACKAGE = '@spyglass/stt' as const;

export { correlateVoiceSegment } from './correlate.ts';
export {
  downloadResponseToFileAtomic,
  downloadUrlToFileAtomic,
  STT_LARGE_DOWNLOAD_TIMEOUT_MS,
  STT_LARGE_MIN_BYTES,
  streamToFileAtomic,
  sttLargeDownloadTimeoutMs,
  writeFileAtomic
} from './download-model.ts';
export type { SttEngine } from './engine.ts';
export type { InProcessFinal, InProcessStt } from './in-process.ts';
export { createInProcessStt } from './in-process.ts';
export { createMockEngine } from './mock-engine.ts';
export type {
  AudioRetention,
  ClientMessage,
  DomAnchor,
  ServerMessage,
  SttEngineName,
  VoiceCorrelation,
  VoiceMode,
  VoiceRelation
} from './protocol.ts';
export {
  DEFAULT_MOCK_TRANSCRIPTS,
  PARTIAL_WINDOW_MS,
  parseAudioRetention,
  parseClientMessage,
  parseCorrelationMarginMs,
  parseMockTranscripts,
  parseServerMessage,
  STT_CHANNELS,
  STT_SAMPLE_RATE,
  VOICE_CORRELATION_MS_DEFAULT,
  VOICE_FLUSH_MS,
  WHISPER_TIMEOUT_MS_DEFAULT
} from './protocol.ts';
export { createEngineFromEnv, resolveSttEngineName } from './resolve-engine.ts';
export type { SidecarHandle } from './sidecar.ts';
export { runSidecarMain, startSidecarServer } from './sidecar.ts';
export type { SttModelChoice, SttUpgradeDecision } from './upgrade.ts';
export {
  chooseWhisperModel,
  largeModelPath,
  largeModelPresent,
  parseMaxLatencyMs,
  parseUpgradePromptAfter,
  readLargeFallback,
  recordFirstUseLatency,
  STT_LARGE_MODEL_FILE,
  STT_LARGE_MODEL_URL,
  STT_LARGE_SHA256,
  STT_MAX_LATENCY_MS_DEFAULT,
  STT_SMALL_MODEL_FILE,
  STT_UPGRADE_PROMPT_AFTER_DEFAULT,
  shouldProposeUpgrade
} from './upgrade.ts';
export type { VadState, VadUtteranceGate } from './vad.ts';
export {
  createVadState,
  frameDurationMs,
  gateVadUtterance,
  pcmRms,
  pushVad,
  VAD_HANGOVER_MS,
  VAD_SPEECH_RMS
} from './vad.ts';
export { concatPcm, pcm16ToWav } from './wav.ts';
export type { WhisperPaths } from './whisper-engine.ts';
export {
  createWhisperEngine,
  notifyFirstUseLatency,
  resolveWhisperPaths,
  runWhisperCli,
  whisperAvailable,
  whisperCandidateBins,
  whisperCandidateModels
} from './whisper-engine.ts';
export type { LocalWsConnection, LocalWsServer } from './ws-localhost.ts';
export { decodeWsFrames, encodeWsFrame, isLoopbackWsHost, listenLocalWs } from './ws-localhost.ts';

export function sidecarStatus(): 'ready' {
  return 'ready';
}
