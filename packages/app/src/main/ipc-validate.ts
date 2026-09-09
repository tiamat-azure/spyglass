import type {
  BrowserBounds,
  ConfigSetRequest,
  ConfigTestRequest,
  GuestVisiblePayload,
  NavGotoRequest,
  RaiseCeilingRequest,
  RefineConfirmRequest,
  RefineEditRequest,
  RefineEstimateRequest,
  RefineRunRequest,
  ReplayStartRequest,
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

export function parseRefineEstimatePayload(input: unknown): RefineEstimateRequest {
  if (typeof input !== 'object' || input === null) {
    return {};
  }
  const aggressiveness = (input as { aggressiveness?: unknown }).aggressiveness;
  if (
    aggressiveness === 'conservative' ||
    aggressiveness === 'balanced' ||
    aggressiveness === 'aggressive'
  ) {
    return { aggressiveness };
  }
  return {};
}

export function parseRefineRunPayload(input: unknown): RefineRunRequest | undefined {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== 'object') {
    return undefined;
  }
  const record = input as { aggressiveness?: unknown; confirm?: unknown };
  const result: RefineRunRequest = {};
  if (
    record.aggressiveness === 'conservative' ||
    record.aggressiveness === 'balanced' ||
    record.aggressiveness === 'aggressive'
  ) {
    result.aggressiveness = record.aggressiveness;
  }
  if (typeof record.confirm === 'boolean') {
    result.confirm = record.confirm;
  }
  return result;
}

export function parseRefineConfirmPayload(input: unknown): RefineConfirmRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as { routine?: unknown; index?: unknown };
  const result: RefineConfirmRequest = {};
  if (record.routine === true) {
    result.routine = true;
  }
  if (typeof record.index === 'number' && Number.isInteger(record.index) && record.index >= 0) {
    result.index = record.index;
  }
  if (result.routine !== true && result.index === undefined) {
    return undefined;
  }
  return result;
}

export function parseRefineEditPayload(input: unknown): RefineEditRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as { index?: unknown; intent?: unknown };
  if (typeof record.index !== 'number' || !Number.isInteger(record.index) || record.index < 0) {
    return undefined;
  }
  const result: RefineEditRequest = { index: record.index };
  if (typeof record.intent === 'string') {
    result.intent = record.intent;
  }
  return result;
}

export function parseReplayStartPayload(input: unknown): ReplayStartRequest {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== 'object') {
    return {};
  }
  const record = input as {
    forceAi?: unknown;
    noAi?: unknown;
    stepByStep?: unknown;
  };
  const result: ReplayStartRequest = {};
  if (record.forceAi === true) {
    result.forceAi = true;
  }
  if (record.noAi === true) {
    result.noAi = true;
  }
  if (record.stepByStep === true) {
    result.stepByStep = true;
  }
  return result;
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

export function parseSttUpgradeDecide(input: unknown): 'accept' | 'refuse' | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const action = (input as { action?: unknown }).action;
  return action === 'accept' || action === 'refuse' ? action : undefined;
}

/** L7-088: session export/import IPC returns stable codes, not absolute paths. */
export function sessionBundleIpcError(
  error: unknown,
  fallback: 'export-failed' | 'import-failed'
): string {
  if (typeof error !== 'object' || error === null) {
    return fallback;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return 'not-found';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('destination is not empty') ||
    message.includes('destination already exists')
  ) {
    return 'dest-not-empty';
  }
  if (message.includes('session already exists')) {
    return 'session-exists';
  }
  if (message.includes('invalid sessionId')) {
    return 'invalid-session';
  }
  if (message.includes('must not be the source') || message.includes('must not overlap')) {
    return 'overlap';
  }
  if (message.includes('symlinks are not allowed')) {
    return 'symlink';
  }
  if (message.includes('missing sessionId')) {
    return 'invalid-meta';
  }
  return fallback;
}
