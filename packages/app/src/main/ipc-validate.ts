import type {
  BrowserBounds,
  ConfigSetRequest,
  ConfigTestRequest,
  GuestVisiblePayload,
  NavGotoRequest,
  RaiseCeilingRequest,
  SessionRetractRequest,
  SessionStartRequest,
  StagehandObserveRequest,
  VoiceEditRequest,
  VoiceStartRequest
} from '../shared/ipc.ts';

export function parseGotoPayload(input: unknown): NavGotoRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('url' in input)) {
    return undefined;
  }
  const url = (input as { url: unknown }).url;
  if (typeof url !== 'string') {
    return undefined;
  }
  return { url };
}

export function parseEmptyPayload(input: unknown): boolean {
  if (input === undefined) {
    return true;
  }
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  return true;
}

export function parseBrowserBoundsPayload(input: unknown): BrowserBounds | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (
    typeof record.x !== 'number' ||
    typeof record.y !== 'number' ||
    typeof record.width !== 'number' ||
    typeof record.height !== 'number'
  ) {
    return undefined;
  }
  return {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height
  };
}

export function parseObservePayload(input: unknown): StagehandObserveRequest | undefined {
  if (input === undefined) {
    return {};
  }
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (record.instruction === undefined) {
    return {};
  }
  if (typeof record.instruction !== 'string') {
    return undefined;
  }
  return { instruction: record.instruction };
}

export function parseSessionStartPayload(input: unknown): SessionStartRequest {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== 'object') {
    return {};
  }
  const record = input as Record<string, unknown>;
  if (typeof record.startUrl === 'string') {
    return { startUrl: record.startUrl };
  }
  return {};
}

export function parseRetractPayload(input: unknown): SessionRetractRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const eventId = (input as { eventId?: unknown }).eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return undefined;
  }
  return { eventId };
}

export function parseConfigSetPayload(input: unknown): ConfigSetRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const result: ConfigSetRequest = {};
  if (record.profile === 'fast' || record.profile === 'smart') {
    result.profile = record.profile;
  }
  if (typeof record.provider === 'string') {
    result.provider = record.provider;
  }
  if (typeof record.model === 'string') {
    result.model = record.model;
  }
  if (typeof record.baseUrl === 'string') {
    result.baseUrl = record.baseUrl;
  }
  if (typeof record.apiKey === 'string') {
    result.apiKey = record.apiKey;
  }
  if (typeof record.enrichmentEnabled === 'boolean') {
    result.enrichmentEnabled = record.enrichmentEnabled;
  }
  if (typeof record.sessionTokenLimitFast === 'number') {
    result.sessionTokenLimitFast = record.sessionTokenLimitFast;
  }
  if (typeof record.tokenWarnRatio === 'number') {
    result.tokenWarnRatio = record.tokenWarnRatio;
  }
  if (typeof record.rateLimitCallsPerMin === 'number') {
    result.rateLimitCallsPerMin = record.rateLimitCallsPerMin;
  }
  if (typeof record.smartTokenConfirm === 'number') {
    result.smartTokenConfirm = record.smartTokenConfirm;
  }
  return result;
}

export function parseConfigTestPayload(input: unknown): ConfigTestRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const profile = (input as { profile?: unknown }).profile;
  if (profile !== 'fast' && profile !== 'smart') {
    return undefined;
  }
  return { profile };
}

export function parseGuestVisiblePayload(input: unknown): GuestVisiblePayload | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const visible = (input as { visible?: unknown }).visible;
  if (typeof visible !== 'boolean') {
    return undefined;
  }
  return { visible };
}

export function parseRaiseCeilingPayload(input: unknown): RaiseCeilingRequest {
  if (typeof input !== 'object' || input === null) {
    return {};
  }
  const tokens = (input as { tokens?: unknown }).tokens;
  if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) {
    return { tokens };
  }
  return {};
}

export function parseVoiceStartPayload(input: unknown): VoiceStartRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const mode = (input as { mode?: unknown }).mode;
  if (mode !== 'hold' && mode !== 'continuous') {
    return undefined;
  }
  return { mode };
}

export function parseVoiceEditPayload(input: unknown): VoiceEditRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as { eventId?: unknown; text?: unknown };
  if (typeof record.eventId !== 'string' || record.eventId.length === 0) {
    return undefined;
  }
  if (typeof record.text !== 'string') {
    return undefined;
  }
  return { eventId: record.eventId, text: record.text };
}

export function asPcmFrame(input: unknown, maxBytes = 65_536): Buffer | undefined {
  if (input instanceof ArrayBuffer) {
    if (input.byteLength === 0 || input.byteLength > maxBytes) {
      return undefined;
    }
    return Buffer.from(input);
  }
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    if (view.byteLength === 0 || view.byteLength > maxBytes) {
      return undefined;
    }
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Buffer.isBuffer(input)) {
    if (input.length === 0 || input.length > maxBytes) {
      return undefined;
    }
    return input;
  }
  return undefined;
}
