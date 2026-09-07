import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrowserBounds,
  NavState,
  PopupRedirectedPayload,
  SessionStatePayload,
  StagehandActResponse,
  StagehandCdpResponse,
  StagehandObserveRequest,
  StagehandObserveResponse
} from '../shared/ipc.ts';
import { IPC } from '../shared/ipc.ts';

const spyglass = {
  lot: '1' as const,
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
