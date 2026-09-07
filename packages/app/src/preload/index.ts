import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrowserBounds,
  NavState,
  PopupRedirectedPayload,
  StagehandCdpResponse,
  StagehandObserveRequest,
  StagehandObserveResponse
} from '../shared/ipc.ts';
import { IPC } from '../shared/ipc.ts';

const spyglass = {
  lot: '0' as const,
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
  stagehand: {
    observe: async (instruction?: string) => {
      const payload: StagehandObserveRequest = {};
      if (instruction !== undefined) {
        payload.instruction = instruction;
      }
      return ipcRenderer.invoke(IPC.stagehandObserve, payload) as Promise<StagehandObserveResponse>;
    },
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
