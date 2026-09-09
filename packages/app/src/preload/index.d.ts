import type {
  BrowserBounds,
  ChatEnrichedPayload,
  ChatMessagePayload,
  ConfigGetResponse,
  ConfigSetRequest,
  ConfigSetResponse,
  ConfigTestResponse,
  NavState,
  PopupRedirectedPayload,
  RefineConfirmRequest,
  RefineEditRequest,
  RefineEstimateResponse,
  RefineFinalizeResponse,
  RefineRevisionView,
  RefineRunResponse,
  RefineStatePayload,
  ReplayProgressPayload,
  ReplayStartResponse,
  SessionStatePayload,
  StagehandActResponse,
  StagehandCdpResponse,
  StagehandObserveResponse,
  UsagePayload,
  VoiceFinalPayload,
  VoiceLevelPayload,
  VoicePartialPayload,
  VoiceStartResponse
} from '../shared/ipc.ts';

export type SpyglassPreloadApi = {
  lot: '7';
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  nav: {
    goto: (url: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
    back: () => Promise<unknown>;
    forward: () => Promise<unknown>;
    reload: () => Promise<unknown>;
    onState: (callback: (state: NavState) => void) => () => void;
    onPopupRedirected: (callback: (payload: PopupRedirectedPayload) => void) => () => void;
  };
  layout: {
    setBrowserBounds: (bounds: BrowserBounds) => void;
    setGuestVisible: (visible: boolean) => void;
  };
  session: {
    start: (startUrl?: string) => Promise<{ sessionId: string }>;
    stop: () => Promise<{ sessionId: string; eventCount: number; sizeBytes: number }>;
    retract: (eventId: string) => Promise<{ retractedEventId: string }>;
    onState: (callback: (state: SessionStatePayload) => void) => () => void;
    onEvent: (callback: (event: Record<string, unknown>) => void) => () => void;
  };
  chat: {
    onMessage: (callback: (message: ChatMessagePayload) => void) => () => void;
    onEnriched: (callback: (payload: ChatEnrichedPayload) => void) => () => void;
  };
  usage: {
    onUpdate: (callback: (usage: UsagePayload) => void) => () => void;
    raiseCeiling: (tokens?: number) => Promise<{ ok: boolean }>;
  };
  config: {
    get: () => Promise<ConfigGetResponse>;
    set: (patch: ConfigSetRequest) => Promise<ConfigSetResponse>;
    test: (profile: 'fast' | 'smart') => Promise<ConfigTestResponse>;
  };
  stagehand: {
    observe: (instruction?: string) => Promise<StagehandObserveResponse>;
    act: () => Promise<StagehandActResponse>;
    cdp: () => Promise<StagehandCdpResponse>;
    onResult: (callback: (result: StagehandObserveResponse) => void) => () => void;
  };
  voice: {
    start: (mode: 'hold' | 'continuous') => Promise<VoiceStartResponse>;
    stop: () => Promise<{ ok: boolean }>;
    abort: () => Promise<{ ok: boolean }>;
    setMode: (mode: 'hold' | 'continuous') => Promise<{ ok: boolean }>;
    frame: (pcm: ArrayBuffer) => void;
    edit: (eventId: string, text: string) => Promise<{ ok: boolean }>;
    onPartial: (callback: (payload: VoicePartialPayload) => void) => () => void;
    onFinal: (callback: (payload: VoiceFinalPayload) => void) => () => void;
    onLevel: (callback: (payload: VoiceLevelPayload) => void) => () => void;
  };
  refine: {
    estimate: (
      aggressiveness?: 'conservative' | 'balanced' | 'aggressive'
    ) => Promise<RefineEstimateResponse>;
    run: (
      aggressiveness?: 'conservative' | 'balanced' | 'aggressive',
      confirm?: boolean
    ) => Promise<RefineRunResponse>;
    confirm: (
      payload: RefineConfirmRequest
    ) => Promise<{ ok: true; revision: RefineRevisionView } | { ok: false; error: string }>;
    edit: (
      payload: RefineEditRequest
    ) => Promise<{ ok: true; revision: RefineRevisionView } | { ok: false; error: string }>;
    finalize: () => Promise<RefineFinalizeResponse>;
    get: () => Promise<RefineRevisionView | undefined>;
    onState: (callback: (payload: RefineStatePayload) => void) => () => void;
  };
  replay: {
    start: (
      forceAi?: boolean,
      noAi?: boolean,
      stepByStep?: boolean
    ) => Promise<ReplayStartResponse>;
    next: () => Promise<{ ok: boolean }>;
    stop: () => Promise<{ ok: boolean }>;
    onProgress: (callback: (payload: ReplayProgressPayload) => void) => () => void;
  };
  sessionBundle: {
    exportTo: (
      destDir: string
    ) => Promise<{ ok: true; dest: string; sessionId: string } | { ok: false; error: string }>;
    importFrom: (
      bundleDir: string
    ) => Promise<
      { ok: true; sessionId: string; sessionDir: string } | { ok: false; error: string }
    >;
  };
  sttUpgrade: {
    status: () => Promise<{
      correctionCount: number;
      refusedPermanently: boolean;
      largeAvailable: boolean;
      propose: boolean;
      fallback: boolean;
    }>;
    decide: (action: 'accept' | 'refuse') => Promise<{ ok: boolean }>;
    onOffer: (callback: (payload: { propose: boolean }) => void) => () => void;
  };
};

declare global {
  interface Window {
    spyglass: SpyglassPreloadApi;
  }
}
