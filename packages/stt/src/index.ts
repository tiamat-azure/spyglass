/**
 * Local STT sidecar (Lot 3). whisper.cpp is the packaged/dev engine (ADR-0013);
 * CI uses the mock engine when binaries/models are absent.
 */
export const STT_PACKAGE = '@spyglass/stt' as const;

export { correlateVoiceSegment } from './correlate.ts';
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
  VOICE_CORRELATION_MS_DEFAULT
} from './protocol.ts';
export { createEngineFromEnv, resolveSttEngineName } from './resolve-engine.ts';
export type { SidecarHandle } from './sidecar.ts';
export { runSidecarMain, startSidecarServer } from './sidecar.ts';
export type { VadState } from './vad.ts';
export {
  createVadState,
  frameDurationMs,
  pcmRms,
  pushVad,
  VAD_HANGOVER_MS,
  VAD_SPEECH_RMS
} from './vad.ts';
export { concatPcm, pcm16ToWav } from './wav.ts';
export type { WhisperPaths } from './whisper-engine.ts';
export {
  createWhisperEngine,
  resolveWhisperPaths,
  runWhisperCli,
  whisperAvailable,
  whisperCandidateBins,
  whisperCandidateModels
} from './whisper-engine.ts';
export type { LocalWsConnection, LocalWsServer } from './ws-localhost.ts';
export { decodeWsFrames, encodeWsFrame, listenLocalWs } from './ws-localhost.ts';

export function sidecarStatus(): 'ready' {
  return 'ready';
}
