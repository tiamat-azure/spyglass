export const SHELL_LOT = '2' as const;

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
  layoutGuestVisible: 'spyglass:layout:guestVisible'
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

export type RecorderState = 'idle' | 'recording' | 'stopping' | 'sealed' | 'sealed-failed';

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
