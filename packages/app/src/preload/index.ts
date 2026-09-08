import { contextBridge, ipcRenderer } from 'electron';
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
  StagehandObserveRequest,
  StagehandObserveResponse,
  UsagePayload
} from '../shared/ipc.ts';
import { IPC } from '../shared/ipc.ts';

const spyglass = {
  lot: '2' as const,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  nav: {
    goto: async (url: string) =>
      ipcRenderer.invoke(IPC.navGoto, { url }) as Promise<
        { ok: true; url: string } | { ok: false; error: string }
      >,
    back: async () => ipcRenderer.invoke(IPC.navBack, {}),
    forward: async () => ipcRenderer.invoke(IPC.navForward, {}),
    reload: async () => ipcRenderer.invoke(IPC.navReload, {}),
    onState: (callback: (state: NavState) => void): (() => void) => {
      const listener = (_event: unknown, state: NavState): void => {
        callback(state);
      };
      ipcRenderer.on(IPC.navState, listener);
      return () => {
        ipcRenderer.removeListener(IPC.navState, listener);
      };
    },
    onPopupRedirected: (callback: (payload: PopupRedirectedPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: PopupRedirectedPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.navPopupRedirected, listener);
      return () => {
        ipcRenderer.removeListener(IPC.navPopupRedirected, listener);
      };
    }
  },
  layout: {
    setBrowserBounds: (bounds: BrowserBounds): void => {
      ipcRenderer.send(IPC.layoutBrowserBounds, bounds);
    },
    setGuestVisible: (visible: boolean): void => {
      ipcRenderer.send(IPC.layoutGuestVisible, { visible });
    }
  },
  session: {
    start: async (startUrl?: string) =>
      ipcRenderer.invoke(IPC.sessionStart, startUrl === undefined ? {} : { startUrl }) as Promise<{
        sessionId: string;
      }>,
    stop: async () =>
      ipcRenderer.invoke(IPC.sessionStop, {}) as Promise<{
        sessionId: string;
        eventCount: number;
        sizeBytes: number;
      }>,
    retract: async (eventId: string) =>
      ipcRenderer.invoke(IPC.sessionRetract, { eventId }) as Promise<{ retractedEventId: string }>,
    onState: (callback: (state: SessionStatePayload) => void): (() => void) => {
      const listener = (_event: unknown, state: SessionStatePayload): void => {
        callback(state);
      };
      ipcRenderer.on(IPC.sessionState, listener);
      return () => {
        ipcRenderer.removeListener(IPC.sessionState, listener);
      };
    },
    onEvent: (callback: (event: Record<string, unknown>) => void): (() => void) => {
      const listener = (_event: unknown, payload: Record<string, unknown>): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.eventAppended, listener);
      return () => {
        ipcRenderer.removeListener(IPC.eventAppended, listener);
      };
    }
  },
  chat: {
    onMessage: (callback: (message: ChatMessagePayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: ChatMessagePayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.chatMessage, listener);
      return () => {
        ipcRenderer.removeListener(IPC.chatMessage, listener);
      };
    },
    onEnriched: (callback: (payload: ChatEnrichedPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: ChatEnrichedPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.chatEnriched, listener);
      return () => {
        ipcRenderer.removeListener(IPC.chatEnriched, listener);
      };
    }
  },
  usage: {
    onUpdate: (callback: (usage: UsagePayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: UsagePayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.usageUpdate, listener);
      return () => {
        ipcRenderer.removeListener(IPC.usageUpdate, listener);
      };
    },
    raiseCeiling: async (tokens?: number) =>
      ipcRenderer.invoke(IPC.usageRaiseCeiling, tokens === undefined ? {} : { tokens }) as Promise<{
        ok: boolean;
      }>
  },
  config: {
    get: async () => ipcRenderer.invoke(IPC.configGet) as Promise<ConfigGetResponse>,
    set: async (patch: ConfigSetRequest) =>
      ipcRenderer.invoke(IPC.configSet, patch) as Promise<ConfigSetResponse>,
    test: async (profile: 'fast' | 'smart') =>
      ipcRenderer.invoke(IPC.configTest, { profile }) as Promise<ConfigTestResponse>
  },
  stagehand: {
    observe: async (instruction?: string) => {
      const payload: StagehandObserveRequest = {};
      if (instruction !== undefined) {
        payload.instruction = instruction;
      }
      return ipcRenderer.invoke(IPC.stagehandObserve, payload) as Promise<StagehandObserveResponse>;
    },
    act: async () => ipcRenderer.invoke(IPC.stagehandAct) as Promise<StagehandActResponse>,
    cdp: async () => ipcRenderer.invoke(IPC.stagehandCdp) as Promise<StagehandCdpResponse>,
    onResult: (callback: (result: StagehandObserveResponse) => void): (() => void) => {
      const listener = (_event: unknown, result: StagehandObserveResponse): void => {
        callback(result);
      };
      ipcRenderer.on(IPC.stagehandResult, listener);
      return () => {
        ipcRenderer.removeListener(IPC.stagehandResult, listener);
      };
    }
  }
};

contextBridge.exposeInMainWorld('spyglass', spyglass);

export type SpyglassPreloadApi = typeof spyglass;
