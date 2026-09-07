export const SHELL_LOT = '0' as const;

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
  stagehandResult: 'spyglass:stagehand:result'
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
