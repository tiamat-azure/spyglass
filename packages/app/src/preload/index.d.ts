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
  SessionStatePayload,
  StagehandActResponse,
  StagehandCdpResponse,
  StagehandObserveResponse,
  UsagePayload
} from '../shared/ipc.ts';

export type SpyglassPreloadApi = {
  lot: '2';
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
};

declare global {
  interface Window {
    spyglass: SpyglassPreloadApi;
  }
}
