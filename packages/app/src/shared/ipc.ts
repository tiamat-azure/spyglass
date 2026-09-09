export const SHELL_LOT = '7' as const;

export const BROWSER_PARTITION = 'persist:spyglass-browser';

export const DEFAULT_SPLIT_RATIO = 0.75;

export const TOOLBAR_HEIGHT_PX = 40;

export const IPC = {
  navGoto: 'spyglass:nav:goto',
  navBack: 'spyglass:nav:back',
  navForward: 'spyglass:nav:forward',
  navReload: 'spyglass:nav:reload',
  navState: 'spyglass:nav:state',
  navPopupRedirected: 'spyglass:nav:popup-redirected',
  layoutBrowserBounds: 'spyglass:layout:browserBounds',
  stagehandObserve: 'spyglass:stagehand:observe',
  stagehandCdp: 'spyglass:stagehand:cdp',
  stagehandResult: 'spyglass:stagehand:result',
  stagehandAct: 'spyglass:stagehand:act',
  sessionStart: 'spyglass:session:start',
  sessionStop: 'spyglass:session:stop',
  sessionRetract: 'spyglass:session:retract',
  sessionState: 'spyglass:session:state',
  eventAppended: 'spyglass:event:appended',
  chatMessage: 'spyglass:chat:message',
  chatEnriched: 'spyglass:chat:enriched',
  usageUpdate: 'spyglass:usage:update',
  usageRaiseCeiling: 'spyglass:usage:raiseCeiling',
  configGet: 'spyglass:config:get',
  configSet: 'spyglass:config:set',
  configTest: 'spyglass:config:test',
  layoutGuestVisible: 'spyglass:layout:guestVisible',
  voiceStart: 'spyglass:voice:start',
  voiceStop: 'spyglass:voice:stop',
  voiceAbort: 'spyglass:voice:abort',
  voiceSetMode: 'spyglass:voice:mode',
  voiceFrame: 'spyglass:voice:frame',
  voicePartial: 'spyglass:voice:partial',
  voiceFinal: 'spyglass:voice:final',
  voiceEdit: 'spyglass:voice:edit',
  voiceLevel: 'spyglass:voice:level',
  refineEstimate: 'spyglass:refine:estimate',
  refineRun: 'spyglass:refine:run',
  refineConfirm: 'spyglass:refine:confirm',
  refineEdit: 'spyglass:refine:edit',
  refineFinalize: 'spyglass:refine:finalize',
  refineGet: 'spyglass:refine:get',
  refineState: 'spyglass:refine:state',
  replayStart: 'spyglass:replay:start',
  replayProgress: 'spyglass:replay:progress',
  replayNext: 'spyglass:replay:next',
  replayStop: 'spyglass:replay:stop',
  sessionExport: 'spyglass:session:export',
  sessionImport: 'spyglass:session:import',
  sttUpgradeStatus: 'spyglass:stt:upgrade-status',
  sttUpgradeOffer: 'spyglass:stt:upgrade-offer',
  sttUpgradeDecide: 'spyglass:stt:upgrade-decide'
} as const;

export type NavState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NavGotoRequest = {
  url: string;
};

export type NavGotoResponse =
  | {
      ok: true;
      url: string;
    }
  | {
      ok: false;
      error: string;
    };

export type PopupRedirectedPayload = {
  url: string;
  source: 'window.open' | 'target=_blank';
};

export type StagehandObserveRequest = {
  instruction?: string;
};

export type StagehandObservation = {
  selector?: string;
  description?: string;
  method?: string;
  arguments?: string[];
};

export type StagehandObserveResponse = {
  ok: boolean;
  instruction: string;
  observations: StagehandObservation[];
  error?: string;
  guestUrl?: string;
  cdpUrl?: string;
  model?: string;
};

export type StagehandCdpResponse = {
  cdpUrl: string;
  port: number;
  guestUrl: string;
  targetId?: string;
};

export type CdpTarget = {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
};

export type RecorderState =
  | 'idle'
  | 'recording'
  | 'stopping'
  | 'sealed'
  | 'sealed-failed'
  | 'refining'
  | 'reviewing'
  | 'finalized'
  | 'replaying';

export type SessionStartRequest = {
  startUrl?: string;
};

export type SessionStartResponse = {
  sessionId: string;
};

export type SessionStopResponse = {
  sessionId: string;
  eventCount: number;
  sizeBytes: number;
};

export type SessionRetractRequest = {
  eventId: string;
};

export type SessionStatePayload = {
  state: RecorderState;
  since: number;
  sessionId?: string;
};

export type StagehandActResponse = {
  ok: boolean;
  llmCalls: number;
  results: Array<{ selector: string; method: string; success: boolean; message: string }>;
  error?: string;
  guestUrl?: string;
  cdpUrl?: string;
};

export type ChatMode = 'template' | 'llm' | 'system';

export type ChatAction = {
  id: 'raise-ceiling';
  label: string;
};

export type ChatMessagePayload = {
  eventId: string;
  stepIndex?: number;
  kind: string;
  mode: ChatMode;
  text: string;
  /** Raw dictation (unwrapped) for Edit — not the gabarit wrapper. */
  transcript?: string;
  technical?: string;
  issuedAt: number;
  retractable: boolean;
  banner?: 'degraded' | 'warning' | 'danger';
  actions?: ChatAction[];
};

export type ChatEnrichedPayload = {
  eventId: string;
  mode: 'llm';
  text: string;
};

export type UsagePayload = {
  profile: 'fast' | 'smart';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  ceiling: number;
  ratio: number;
  halt: string;
  estimatedUsd?: number;
};

export type ConfigSource = 'default' | 'env' | 'ui';

export type MaskedProfileConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  sources: {
    provider: ConfigSource;
    model: ConfigSource;
    baseUrl: ConfigSource;
    apiKey: ConfigSource;
  };
};

export type ConfigGetResponse = {
  enrichmentEnabled: boolean;
  sessionTokenLimitFast: number;
  tokenWarnRatio: number;
  rateLimitCallsPerMin: number;
  smartTokenConfirm: number;
  encryptionAvailable: boolean;
  fast: MaskedProfileConfig;
  smart: MaskedProfileConfig;
};

export type ConfigSetRequest = {
  profile?: 'fast' | 'smart';
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  enrichmentEnabled?: boolean;
  sessionTokenLimitFast?: number;
  tokenWarnRatio?: number;
  rateLimitCallsPerMin?: number;
  smartTokenConfirm?: number;
};

export type ConfigSetResponse = {
  ok: boolean;
  persistedKey: boolean;
  error?: string;
};

export type ConfigTestRequest = {
  profile: 'fast' | 'smart';
};

export type ConfigTestResponse = {
  ok: boolean;
  latencyMs: number;
  multimodal: boolean;
  error?: string;
};

export type GuestVisiblePayload = {
  visible: boolean;
};

export type RaiseCeilingRequest = {
  tokens?: number;
};

export type VoiceMode = 'hold' | 'continuous';

export type VoiceStartRequest = {
  mode: VoiceMode;
};

export type VoiceStartResponse = {
  ok: boolean;
  mode: VoiceMode;
  engine: 'mock' | 'whisper';
  model: string;
  fakeCapture: boolean;
  error?: string;
};

export type VoiceStopResponse = {
  ok: boolean;
};

export type VoicePartialPayload = {
  utteranceId: string;
  text: string;
  startTs: number;
};

export type VoiceFinalPayload = {
  eventId: string;
  utteranceId: string;
  text: string;
  startTs: number;
  endTs: number;
  relation?: 'before' | 'after' | 'unanchored';
  correlatedEventId?: string;
  correlatedStepIndex?: number;
};

export type VoiceEditRequest = {
  eventId: string;
  text: string;
};

export type VoiceLevelPayload = {
  rms: number;
};

export type RefineAggressiveness = 'conservative' | 'balanced' | 'aggressive';

export type RefineEstimateRequest = {
  aggressiveness?: RefineAggressiveness;
};

export type RefineEstimateResponse = {
  ok: boolean;
  sessionId?: string;
  estimatedTokens: number;
  threshold: number;
  requiresConfirm: boolean;
  model: string;
  eventCount: number;
  error?: string;
};

export type RefineRunRequest = {
  aggressiveness?: RefineAggressiveness;
  confirm?: boolean;
};

export type RefinedStepView = {
  index: number;
  intent: string;
  actionType: string;
  selector: string;
  verificationType: string;
  expected: string;
  strength: 'strong' | 'weak';
  weakReason?: string;
  weakGroup?: 'routine' | 'doubtful';
  confirmedByUser: boolean;
  sourceEvents: string[];
};

export type RefineRevisionView = {
  sessionId: string;
  revision: number;
  status: 'reviewing' | 'finalized';
  aggressiveness: RefineAggressiveness;
  model: string;
  observeEnrichment: boolean;
  estimatedTokens: number;
  actualTokens: number;
  source: 'smart' | 'fallback';
  steps: RefinedStepView[];
  unconfirmedWeak: number;
  routineUnconfirmed: number;
  doubtfulUnconfirmed: number;
  canFinalize: boolean;
};

/** LOT4-R1: chrome must not look like a smart refine when the engine fell back. */
export function refineSourceBanner(source: 'smart' | 'fallback'): {
  text: string;
  tone: 'smart' | 'fallback';
} {
  if (source === 'fallback') {
    return {
      text: 'Repli déterministe — ce n’est pas un raffinement smart',
      tone: 'fallback'
    };
  }
  return { text: 'Profil smart', tone: 'smart' };
}

export type RefineRunResponse =
  | { ok: true; revision: RefineRevisionView }
  | { ok: false; error: string; needsConfirm?: boolean; estimatedTokens?: number };

export type RefineConfirmRequest = {
  routine?: boolean;
  index?: number;
};

export type RefineEditRequest = {
  index: number;
  intent?: string;
};

export type RefineFinalizeResponse =
  | { ok: true; revision: RefineRevisionView }
  | { ok: false; error: string; unconfirmedWeak?: number };

export type RefineStatePayload = {
  phase: RecorderState;
  revision?: RefineRevisionView;
};

export type ReplayStartRequest = {
  forceAi?: boolean;
  noAi?: boolean;
  stepByStep?: boolean;
};

export type ReplayStartResponse =
  | { ok: true; runId: string }
  | { ok: false; error: string; runId?: string };

export type ReplayProgressPayload = {
  runId: string;
  stepIndex: number;
  status: 'running' | 'passed' | 'failed' | 'recovering';
  mode: 'script' | 'AI';
  attempt: number;
  message: string;
};

export type SessionExportRequest = Record<string, never>;

export type SessionExportResponse =
  | { ok: true; dest: string; sessionId: string }
  | { ok: false; error: string };

export type SessionImportRequest = Record<string, never>;

export type SessionImportResponse =
  | { ok: true; sessionId: string; sessionDir: string }
  | { ok: false; error: string };

export type SttUpgradeStatus = {
  correctionCount: number;
  refusedPermanently: boolean;
  largeAvailable: boolean;
  propose: boolean;
  fallback: boolean;
  error?: string;
};

export type SttUpgradeDecideRequest = {
  action: 'accept' | 'refuse';
};
