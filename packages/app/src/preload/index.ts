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
  StagehandObserveRequest,
  StagehandObserveResponse,
  UsagePayload,
  VoiceFinalPayload,
  VoiceLevelPayload,
  VoicePartialPayload,
  VoiceStartResponse
} from '../shared/ipc.ts';
import { IPC } from '../shared/ipc.ts';

const spyglass = {
  lot: '7' as const,
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
  },
  voice: {
    start: async (mode: 'hold' | 'continuous') =>
      ipcRenderer.invoke(IPC.voiceStart, { mode }) as Promise<VoiceStartResponse>,
    stop: async () => ipcRenderer.invoke(IPC.voiceStop, {}) as Promise<{ ok: boolean }>,
    abort: async () => ipcRenderer.invoke(IPC.voiceAbort, {}) as Promise<{ ok: boolean }>,
    setMode: async (mode: 'hold' | 'continuous') =>
      ipcRenderer.invoke(IPC.voiceSetMode, { mode }) as Promise<{ ok: boolean }>,
    frame: (pcm: ArrayBuffer): void => {
      ipcRenderer.send(IPC.voiceFrame, pcm);
    },
    edit: async (eventId: string, text: string) =>
      ipcRenderer.invoke(IPC.voiceEdit, { eventId, text }) as Promise<{ ok: boolean }>,
    onPartial: (callback: (payload: VoicePartialPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: VoicePartialPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.voicePartial, listener);
      return () => {
        ipcRenderer.removeListener(IPC.voicePartial, listener);
      };
    },
    onFinal: (callback: (payload: VoiceFinalPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: VoiceFinalPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.voiceFinal, listener);
      return () => {
        ipcRenderer.removeListener(IPC.voiceFinal, listener);
      };
    },
    onLevel: (callback: (payload: VoiceLevelPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: VoiceLevelPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.voiceLevel, listener);
      return () => {
        ipcRenderer.removeListener(IPC.voiceLevel, listener);
      };
    }
  },
  refine: {
    estimate: async (aggressiveness?: 'conservative' | 'balanced' | 'aggressive') =>
      ipcRenderer.invoke(
        IPC.refineEstimate,
        aggressiveness === undefined ? {} : { aggressiveness }
      ) as Promise<RefineEstimateResponse>,
    run: async (aggressiveness?: 'conservative' | 'balanced' | 'aggressive', confirm?: boolean) => {
      const payload: {
        aggressiveness?: 'conservative' | 'balanced' | 'aggressive';
        confirm?: boolean;
      } = {};
      if (aggressiveness !== undefined) {
        payload.aggressiveness = aggressiveness;
      }
      if (confirm !== undefined) {
        payload.confirm = confirm;
      }
      return ipcRenderer.invoke(IPC.refineRun, payload) as Promise<RefineRunResponse>;
    },
    confirm: async (payload: RefineConfirmRequest) =>
      ipcRenderer.invoke(IPC.refineConfirm, payload) as Promise<
        { ok: true; revision: RefineRevisionView } | { ok: false; error: string }
      >,
    edit: async (payload: RefineEditRequest) =>
      ipcRenderer.invoke(IPC.refineEdit, payload) as Promise<
        { ok: true; revision: RefineRevisionView } | { ok: false; error: string }
      >,
    finalize: async () =>
      ipcRenderer.invoke(IPC.refineFinalize, {}) as Promise<RefineFinalizeResponse>,
    get: async () =>
      ipcRenderer.invoke(IPC.refineGet, {}) as Promise<RefineRevisionView | undefined>,
    onState: (callback: (payload: RefineStatePayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: RefineStatePayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.refineState, listener);
      return () => {
        ipcRenderer.removeListener(IPC.refineState, listener);
      };
    }
  },
  replay: {
    start: async (forceAi?: boolean, noAi?: boolean, stepByStep?: boolean) => {
      const payload: { forceAi?: boolean; noAi?: boolean; stepByStep?: boolean } = {};
      if (forceAi === true) {
        payload.forceAi = true;
      }
      if (noAi === true) {
        payload.noAi = true;
      }
      if (stepByStep === true) {
        payload.stepByStep = true;
      }
      return ipcRenderer.invoke(IPC.replayStart, payload) as Promise<ReplayStartResponse>;
    },
    next: async () => ipcRenderer.invoke(IPC.replayNext, {}) as Promise<{ ok: boolean }>,
    stop: async () => ipcRenderer.invoke(IPC.replayStop, {}) as Promise<{ ok: boolean }>,
    onProgress: (callback: (payload: ReplayProgressPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: ReplayProgressPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.replayProgress, listener);
      return () => {
        ipcRenderer.removeListener(IPC.replayProgress, listener);
      };
    }
  },
  sessionBundle: {
    exportTo: async (destDir: string) =>
      ipcRenderer.invoke(IPC.sessionExport, { destDir }) as Promise<
        { ok: true; dest: string; sessionId: string } | { ok: false; error: string }
      >,
    importFrom: async (bundleDir: string) =>
      ipcRenderer.invoke(IPC.sessionImport, { bundleDir }) as Promise<
        { ok: true; sessionId: string; sessionDir: string } | { ok: false; error: string }
      >
  },
  sttUpgrade: {
    status: async () =>
      ipcRenderer.invoke(IPC.sttUpgradeStatus, {}) as Promise<{
        correctionCount: number;
        refusedPermanently: boolean;
        largeAvailable: boolean;
        propose: boolean;
        fallback: boolean;
      }>,
    decide: async (action: 'accept' | 'refuse') =>
      ipcRenderer.invoke(IPC.sttUpgradeDecide, { action }) as Promise<{ ok: boolean }>,
    onOffer: (callback: (payload: { propose: boolean }) => void): (() => void) => {
      const listener = (_event: unknown, payload: { propose: boolean }): void => {
        callback(payload);
      };
      ipcRenderer.on(IPC.sttUpgradeOffer, listener);
      return () => {
        ipcRenderer.removeListener(IPC.sttUpgradeOffer, listener);
      };
    }
  }
};

contextBridge.exposeInMainWorld('spyglass', spyglass);

export type SpyglassPreloadApi = typeof spyglass;
