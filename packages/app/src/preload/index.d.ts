import type {
  BrowserBounds,
  NavState,
  PopupRedirectedPayload,
  StagehandCdpResponse,
  StagehandObserveResponse
} from '../shared/ipc.ts';

export type SpyglassPreloadApi = {
  lot: '0';
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
  };
  stagehand: {
    observe: (instruction?: string) => Promise<StagehandObserveResponse>;
    cdp: () => Promise<StagehandCdpResponse>;
    onResult: (callback: (result: StagehandObserveResponse) => void) => () => void;
  };
};

declare global {
  interface Window {
    spyglass: SpyglassPreloadApi;
  }
}
