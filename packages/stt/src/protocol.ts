export const STT_SAMPLE_RATE = 16_000;
export const STT_CHANNELS = 1;
export const PARTIAL_WINDOW_MS = 400;
export const WHISPER_TIMEOUT_MS_DEFAULT = 8_000;
/** stopCapture flush: whisper timeout plus journal settle. Must be ≥ whisper timeout. */
export const VOICE_FLUSH_MS = WHISPER_TIMEOUT_MS_DEFAULT + 2_000;

/**
 * L27b: whisper-cli process timeout (`beginWhisperFromEnv`). Distinct from
 * `STT_MAX_LATENCY_MS` (first-use large→small budget). Unset/invalid → 8000.
 */
export function parseWhisperTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STT_WHISPER_TIMEOUT_MS;
  if (raw === undefined || raw.trim().length === 0) {
    return WHISPER_TIMEOUT_MS_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : WHISPER_TIMEOUT_MS_DEFAULT;
}

export const VOICE_CORRELATION_MS_DEFAULT = 8_000;
export const DEFAULT_MOCK_TRANSCRIPTS = [
  'Je vais cliquer sur Démarrer',
  "J'ai validé l'étape"
] as const;

export type VoiceMode = 'hold' | 'continuous';
export type SttEngineName = 'mock' | 'whisper';
export type VoiceRelation = 'before' | 'after' | 'unanchored';
export type AudioRetention = 'none' | 'corrected' | 'all';

export type ClientHello = {
  type: 'hello';
  sampleRate: number;
};

export type ClientStart = {
  type: 'start';
  utteranceId: string;
  startTs: number;
};

export type ClientEnd = {
  type: 'end';
  utteranceId: string;
  endTs: number;
};

export type ClientAbort = {
  type: 'abort';
};

export type ClientMessage = ClientHello | ClientStart | ClientEnd | ClientAbort;

export type ServerReady = {
  type: 'ready';
  engine: SttEngineName;
  model: string;
  network: false;
};

export type ServerPartial = {
  type: 'partial';
  utteranceId: string;
  text: string;
  startTs: number;
};

export type ServerFinal = {
  type: 'final';
  utteranceId: string;
  text: string;
  startTs: number;
  endTs: number;
};

export type ServerError = {
  type: 'error';
  message: string;
};

export type ServerMessage = ServerReady | ServerPartial | ServerFinal | ServerError;

export type DomAnchor = {
  eventId: string;
  stepIndex: number;
  ts: number;
};

export type VoiceCorrelation = {
  relation: VoiceRelation;
  correlatedEventId?: string;
  correlatedStepIndex?: number;
};

export function parseClientMessage(input: unknown): ClientMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (record.type === 'hello') {
    if (typeof record.sampleRate !== 'number' || !Number.isFinite(record.sampleRate)) {
      return undefined;
    }
    return { type: 'hello', sampleRate: record.sampleRate };
  }
  if (record.type === 'abort') {
    return { type: 'abort' };
  }
  if (record.type === 'start' || record.type === 'end') {
    if (typeof record.utteranceId !== 'string' || record.utteranceId.length === 0) {
      return undefined;
    }
    const tsKey = record.type === 'start' ? 'startTs' : 'endTs';
    const ts = record[tsKey];
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      return undefined;
    }
    if (record.type === 'start') {
      return { type: 'start', utteranceId: record.utteranceId, startTs: ts };
    }
    return { type: 'end', utteranceId: record.utteranceId, endTs: ts };
  }
  return undefined;
}

export function parseServerMessage(input: unknown): ServerMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (record.type === 'ready') {
    if (record.engine !== 'mock' && record.engine !== 'whisper') {
      return undefined;
    }
    if (typeof record.model !== 'string') {
      return undefined;
    }
    return { type: 'ready', engine: record.engine, model: record.model, network: false };
  }
  if (record.type === 'error') {
    if (typeof record.message !== 'string') {
      return undefined;
    }
    return { type: 'error', message: record.message };
  }
  if (record.type === 'partial' || record.type === 'final') {
    if (typeof record.utteranceId !== 'string' || typeof record.text !== 'string') {
      return undefined;
    }
    if (typeof record.startTs !== 'number') {
      return undefined;
    }
    if (record.type === 'partial') {
      return {
        type: 'partial',
        utteranceId: record.utteranceId,
        text: record.text,
        startTs: record.startTs
      };
    }
    if (typeof record.endTs !== 'number') {
      return undefined;
    }
    return {
      type: 'final',
      utteranceId: record.utteranceId,
      text: record.text,
      startTs: record.startTs,
      endTs: record.endTs
    };
  }
  return undefined;
}

export function parseMockTranscripts(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [...DEFAULT_MOCK_TRANSCRIPTS];
  }
  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [...DEFAULT_MOCK_TRANSCRIPTS];
}

export function parseAudioRetention(raw: string | undefined): AudioRetention {
  if (raw === 'corrected' || raw === 'all') {
    return raw;
  }
  return 'none';
}

export function parseCorrelationMarginMs(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return VOICE_CORRELATION_MS_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : VOICE_CORRELATION_MS_DEFAULT;
}
