import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toObserveResult } from '@spyglass/probe';
import { exportSessionFolder, importSessionFolder } from '@spyglass/runner';
import {
  downloadUrlToFileAtomic,
  largeModelPath,
  largeModelPresent,
  readLargeFallback,
  STT_LARGE_MIN_BYTES,
  STT_LARGE_MODEL_FILE,
  STT_LARGE_MODEL_URL,
  sttLargeDownloadTimeoutMs,
  writeFileAtomic
} from '@spyglass/stt';
import { app, BrowserWindow, dialog, ipcMain, type Session, type WebContents } from 'electron';
import type {
  NavState,
  PopupRedirectedPayload,
  RefineEstimateResponse,
  RefineFinalizeResponse,
  RefineRunResponse,
  RefineStatePayload,
  ReplayProgressPayload,
  ReplayStartResponse,
  SessionStatePayload,
  StagehandActResponse,
  StagehandCdpResponse,
  StagehandObserveResponse,
  VoiceFinalPayload,
  VoiceStartResponse
} from '../shared/ipc.ts';
import { IPC } from '../shared/ipc.ts';
import { BrowserPane } from './browser-pane.ts';
import { infoFromTarget, writeCdpInfoFile } from './cdp-info.ts';
import { isRemoteDebuggingRequested } from './cdp-policy.ts';
import { cdpHttpUrl, enableRemoteDebugging, resolveCdpPort } from './cdp-port.ts';
import { parseCdpTargetList, pickGuestTarget, resolvePinnedChromeTargetId } from './cdp-targets.ts';
import { ElectronPageDriver } from './electron-driver.ts';
import { isChromeIpcSender } from './ipc-sender.ts';
import {
  asPcmFrame,
  parseBrowserBoundsPayload,
  parseConfigSetPayload,
  parseConfigTestPayload,
  parseEmptyPayload,
  parseGotoPayload,
  parseGuestVisiblePayload,
  parseObservePayload,
  parseRaiseCeilingPayload,
  parseRefineConfirmPayload,
  parseRefineEditPayload,
  parseRefineEstimatePayload,
  parseRefineRunPayload,
  parseReplayStartPayload,
  parseRetractPayload,
  parseSessionStartPayload,
  parseSttUpgradeDecide,
  parseVoiceEditPayload,
  parseVoiceStartPayload,
  sessionBundleIpcError
} from './ipc-validate.ts';
import { clampBrowserBoundsToChrome, fallbackBrowserBounds, roundBrowserBounds } from './layout.ts';
import { isLlmOffline } from './llm-transport.ts';
import { normalizeGotoUrl } from './nav-url.ts';
import { createObserverRuntime, type ObserverRuntime } from './observer-host.ts';
import { RefineEngine } from './refine-engine.ts';
import { ReplayEngine } from './replay-engine.ts';
import { SessionOrchestrator, sessionsDirFromEnv } from './session-orchestrator.ts';
import { emptyConfig } from './settings-store.ts';
import { runStagehandAct } from './stagehand-act.ts';
import { runStagehandObserve } from './stagehand-bridge.ts';
import { resolveSttLargeExpectedSha256, sttUpgradeFakeEnabled } from './stt-upgrade-policy.ts';
import { SttUpgradeStore, sttUpgradeStorePath } from './stt-upgrade-store.ts';
import { VoiceBridge } from './voice-bridge.ts';
import { installWebContentsSecurityDefaults } from './web-security-install.ts';

if (process.platform === 'linux' || process.env.SPYGLASS_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

if (process.env.SPYGLASS_NO_SANDBOX === '1' || process.env.CI === 'true') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('no-zygote');
}

const userDataOverride = process.env.SPYGLASS_USER_DATA;
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath('userData', userDataOverride);
}

installWebContentsSecurityDefaults();

let activePane: BrowserPane | undefined;
let activeSession: SessionOrchestrator | undefined;
let observerRuntime: ObserverRuntime | undefined;
let activeRefine: RefineEngine | undefined;
let activeReplay: ReplayEngine | undefined;
let voiceBridge: VoiceBridge | undefined;
let sttUpgradeStore: SttUpgradeStore | undefined;
let sttUpgradeStoreLoading: Promise<SttUpgradeStore> | undefined;
/** L7-165: serialize accept/refuse so a concurrent accept cannot start a large download after refuse. */
let sttUpgradeDecideQueue: Promise<unknown> = Promise.resolve();
let ipcRegistered = false;
let pinnedChromeTargetId: string | undefined;
const netCompletedBound = new WeakSet<Session>();

function preloadPath(): string {
  return join(import.meta.dirname, '../preload/index.cjs');
}

function rendererIndexPath(): string {
  return join(import.meta.dirname, '../renderer/index.html');
}

function screenshotExitRequested(): boolean {
  return process.env.SPYGLASS_SCREENSHOT_EXIT === '1';
}

function quitAfterScreenshot(failed: boolean): void {
  if (!screenshotExitRequested()) {
    return;
  }
  if (failed) {
    app.exit(1);
    return;
  }
  app.quit();
}

function cdpInfoPath(): string | undefined {
  const fromEnv = process.env.SPYGLASS_CDP_INFO;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(app.getPath('userData'), 'cdp.json');
}

async function fetchCdpTargets(port: number): Promise<ReturnType<typeof parseCdpTargetList>> {
  const response = await fetch(`${cdpHttpUrl(port)}/json/list`);
  if (!response.ok) {
    return [];
  }
  const payload: unknown = await response.json();
  return parseCdpTargetList(payload);
}

function pickGuestOptions(): { excludeTargetIds: string[] } | undefined {
  if (pinnedChromeTargetId === undefined || pinnedChromeTargetId.length === 0) {
    return undefined;
  }
  return { excludeTargetIds: [pinnedChromeTargetId] };
}

function pinChromeFromWebContents(webContents: WebContents | undefined): void {
  if (pinnedChromeTargetId !== undefined && pinnedChromeTargetId.length > 0) {
    return;
  }
  if (webContents === undefined || webContents.isDestroyed()) {
    return;
  }
  try {
    const id = webContents.getOrCreateDevToolsTargetId();
    if (typeof id === 'string' && id.length > 0) {
      pinnedChromeTargetId = id;
    }
  } catch {
    // DevTools agent may not exist until the renderer has a CDP target.
  }
}

function pinChromeTargetFromList(
  webContents: WebContents | undefined,
  targets: ReturnType<typeof parseCdpTargetList>,
  guestUrl: string
): void {
  pinChromeFromWebContents(webContents);
  if (pinnedChromeTargetId !== undefined && pinnedChromeTargetId.length > 0) {
    return;
  }
  if (webContents === undefined || webContents.isDestroyed()) {
    return;
  }
  const id = resolvePinnedChromeTargetId(targets, webContents.getURL(), guestUrl);
  if (id !== undefined) {
    pinnedChromeTargetId = id;
  }
}

async function persistCdpInfo(
  port: number,
  guestUrl: string,
  guestTitle: string,
  chromeWebContents?: WebContents
): Promise<void> {
  if (port <= 0) {
    return;
  }
  const path = cdpInfoPath();
  if (path === undefined) {
    return;
  }
  let target: ReturnType<typeof pickGuestTarget>;
  try {
    const targets = await fetchCdpTargets(port);
    pinChromeTargetFromList(chromeWebContents, targets, guestUrl);
    target = pickGuestTarget(targets, guestUrl, pickGuestOptions());
  } catch {
    target = undefined;
  }
  await writeCdpInfoFile(
    path,
    infoFromTarget(port, guestUrl, guestTitle, target, pinnedChromeTargetId)
  );
}

async function waitForGuestPaint(guest: WebContents): Promise<void> {
  if (!guest.isLoading()) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 8_000);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    guest.once('did-finish-load', done);
    guest.once('did-fail-load', done);
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function persistObserveResultIfRequested(result: StagehandObserveResponse): Promise<void> {
  const out = process.env.SPYGLASS_OBSERVE_RESULT;
  if (out === undefined || out.length === 0) {
    return;
  }
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function captureIfRequested(win: BrowserWindow, guest: WebContents): Promise<void> {
  const out = process.env.SPYGLASS_SCREENSHOT_PATH;
  if (out === undefined || out.length === 0) {
    return;
  }
  let failed = false;
  try {
    await waitForGuestPaint(guest);
    const image = await win.capturePage();
    await writeFile(out, image.toPNG());
  } catch (error) {
    failed = true;
    console.error('Failed to capture Lot 0 screenshot:', error);
  } finally {
    quitAfterScreenshot(failed);
  }
}

function createWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Spyglass',
    backgroundColor: '#06090F',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
}

async function ensureSttUpgradeStore(): Promise<SttUpgradeStore> {
  if (sttUpgradeStore !== undefined) {
    return sttUpgradeStore;
  }
  if (sttUpgradeStoreLoading === undefined) {
    sttUpgradeStoreLoading = (async () => {
      const store = new SttUpgradeStore(sttUpgradeStorePath(app.getPath('userData')), process.env);
      await store.load();
      sttUpgradeStore = store;
      return store;
    })();
  }
  try {
    return await sttUpgradeStoreLoading;
  } catch (error) {
    sttUpgradeStoreLoading = undefined;
    throw error;
  }
}

function enqueueSttUpgradeDecide<T>(task: () => Promise<T>): Promise<T> {
  const run = sttUpgradeDecideQueue.then(task, task);
  sttUpgradeDecideQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function resolveSttModelDir(): string {
  const fromEnv = process.env.STT_MODEL_DIR;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(app.getPath('userData'), 'whisper');
}

async function pickSessionDirectory(
  win: BrowserWindow | undefined,
  title: string,
  allowCreate: boolean
): Promise<string | undefined> {
  const properties: Array<'openDirectory' | 'createDirectory'> = ['openDirectory'];
  if (allowCreate) {
    properties.push('createDirectory');
  }
  const options = {
    title,
    properties
  };
  const picked =
    win !== undefined && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  if (picked.canceled) {
    return undefined;
  }
  const path = picked.filePaths[0];
  return path !== undefined && path.length > 0 ? path : undefined;
}

function emitToChrome(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function requirePane(): BrowserPane {
  if (activePane === undefined) {
    throw new Error('Browser pane is not ready');
  }
  return activePane;
}

function rejectForeignIpc(
  event: { sender: { id: number; isDestroyed?: () => boolean } },
  winRef: { current: BrowserWindow | undefined },
  channel: string
): boolean {
  if (isChromeIpcSender(event, winRef.current)) {
    return false;
  }
  console.error(`Rejected ${channel} from non-chrome sender`);
  return true;
}

function requireSession(): SessionOrchestrator {
  if (activeSession === undefined) {
    throw new Error('Session orchestrator is not ready');
  }
  return activeSession;
}

function emitRefineState(winRef: { current: BrowserWindow | undefined }): void {
  const win = winRef.current;
  if (win === undefined) {
    return;
  }
  const payload: RefineStatePayload = {
    phase: activeSession?.snapshot().state ?? 'idle'
  };
  const revision = activeRefine?.view();
  if (revision !== undefined) {
    payload.revision = revision;
  }
  emitToChrome(win, IPC.refineState, payload);
}

function registerIpc(cdpPort: number, winRef: { current: BrowserWindow | undefined }): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle(IPC.navGoto, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.navGoto)) {
      return { ok: false, error: 'forbidden' };
    }
    const payload = parseGotoPayload(raw);
    if (payload === undefined) {
      console.error('Rejected invalid spyglass:nav:goto payload');
      return { ok: false, error: 'invalid payload' };
    }
    const url = normalizeGotoUrl(payload.url);
    if (url === undefined) {
      return { ok: false, error: 'only http(s) URLs are allowed' };
    }
    await requirePane().goto(url);
    return { ok: true, url };
  });

  ipcMain.handle(IPC.navBack, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.navBack)) {
      return { ok: false };
    }
    if (!parseEmptyPayload(raw)) {
      console.error('Rejected invalid spyglass:nav:back payload');
      return { ok: false };
    }
    requirePane().back();
    return { ok: true };
  });

  ipcMain.handle(IPC.navForward, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.navForward)) {
      return { ok: false };
    }
    if (!parseEmptyPayload(raw)) {
      console.error('Rejected invalid spyglass:nav:forward payload');
      return { ok: false };
    }
    requirePane().forward();
    return { ok: true };
  });

  ipcMain.handle(IPC.navReload, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.navReload)) {
      return { ok: false };
    }
    if (!parseEmptyPayload(raw)) {
      console.error('Rejected invalid spyglass:nav:reload payload');
      return { ok: false };
    }
    requirePane().reload();
    return { ok: true };
  });

  ipcMain.handle(IPC.stagehandCdp, async (event): Promise<StagehandCdpResponse> => {
    if (rejectForeignIpc(event, winRef, IPC.stagehandCdp)) {
      return { cdpUrl: '', port: 0, guestUrl: '' };
    }
    const snapshot = requirePane().snapshot();
    if (cdpPort <= 0) {
      return {
        cdpUrl: '',
        port: 0,
        guestUrl: snapshot.url
      };
    }
    let targetId: string | undefined;
    try {
      const targets = await fetchCdpTargets(cdpPort);
      const win = winRef.current;
      if (win !== undefined && !win.isDestroyed()) {
        pinChromeTargetFromList(win.webContents, targets, snapshot.url);
      }
      targetId = pickGuestTarget(targets, snapshot.url, pickGuestOptions())?.id;
    } catch {
      targetId = undefined;
    }
    const response: StagehandCdpResponse = {
      cdpUrl: cdpHttpUrl(cdpPort),
      port: cdpPort,
      guestUrl: snapshot.url
    };
    if (targetId !== undefined) {
      response.targetId = targetId;
    }
    return response;
  });

  ipcMain.handle(IPC.stagehandObserve, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.stagehandObserve)) {
      return {
        ok: false,
        instruction: '',
        observations: [],
        error: 'forbidden'
      } satisfies StagehandObserveResponse;
    }
    const payload = parseObservePayload(raw);
    if (payload === undefined) {
      console.error('Rejected invalid spyglass:stagehand:observe payload');
      return {
        ok: false,
        instruction: '',
        observations: [],
        error: 'invalid payload'
      } satisfies StagehandObserveResponse;
    }
    const snapshot = requirePane().snapshot();
    if (cdpPort <= 0) {
      const disabled: StagehandObserveResponse = {
        ok: false,
        instruction: payload.instruction ?? '',
        observations: [],
        error:
          'Remote debugging is off. Launch with SPYGLASS_CDP=1 (packaged) or use a dev build / SPYGLASS_OBSERVE_ON_START=1.',
        guestUrl: snapshot.url
      };
      const disabledWin = winRef.current;
      if (disabledWin !== undefined) {
        emitToChrome(disabledWin, IPC.stagehandResult, disabled);
      }
      return disabled;
    }
    const observeWin = winRef.current;
    if (observeWin !== undefined && !observeWin.isDestroyed()) {
      try {
        const targets = await fetchCdpTargets(cdpPort);
        pinChromeTargetFromList(observeWin.webContents, targets, snapshot.url);
      } catch {
        // pin is best-effort; Observe still excludes whatever we already stored
      }
    }
    const result = await runStagehandObserve({
      cdpUrl: cdpHttpUrl(cdpPort),
      guestUrl: snapshot.url,
      instruction: payload.instruction,
      appPath: app.getAppPath(),
      chromeTargetId: pinnedChromeTargetId
    });
    const win = winRef.current;
    if (win !== undefined) {
      emitToChrome(win, IPC.stagehandResult, result);
    }
    return result;
  });

  ipcMain.handle(IPC.sessionStart, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.sessionStart)) {
      return { sessionId: '' };
    }
    const payload = parseSessionStartPayload(raw);
    const snapshot = requirePane().snapshot();
    const startUrl = payload.startUrl ?? snapshot.url;
    const started = await requireSession().start(startUrl);
    voiceBridge?.resumeCapture();
    observerRuntime?.observer.onSessionStart(started.sessionId);
    activeRefine?.reset();
    emitRefineState(winRef);
    return started;
  });

  ipcMain.handle(IPC.sessionStop, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.sessionStop)) {
      return { sessionId: '', eventCount: 0, sizeBytes: 0 };
    }
    if (!parseEmptyPayload(raw)) {
      return { sessionId: '', eventCount: 0, sizeBytes: 0 };
    }
    const win = winRef.current;
    if (win !== undefined && activeSession !== undefined) {
      emitToChrome(win, IPC.sessionState, {
        ...activeSession.snapshot(),
        state: 'stopping'
      });
    }
    voiceBridge?.beginStop();
    await voiceBridge?.stopCapture();
    try {
      const stopped = await requireSession().stop();
      emitRefineState(winRef);
      return stopped;
    } catch (error) {
      if (activeSession?.snapshot().state === 'recording') {
        voiceBridge?.resumeCapture();
      }
      throw error;
    }
  });

  ipcMain.handle(IPC.sessionRetract, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.sessionRetract)) {
      return { retractedEventId: '' };
    }
    const payload = parseRetractPayload(raw);
    if (payload === undefined) {
      console.error('Rejected invalid spyglass:session:retract payload');
      return { retractedEventId: '' };
    }
    return await requireSession().retract(payload.eventId);
  });

  ipcMain.handle(IPC.stagehandAct, async (event): Promise<StagehandActResponse> => {
    if (rejectForeignIpc(event, winRef, IPC.stagehandAct)) {
      return { ok: false, llmCalls: 0, results: [], error: 'forbidden' };
    }
    const snapshot = requirePane().snapshot();
    if (cdpPort <= 0) {
      return {
        ok: false,
        llmCalls: 0,
        results: [],
        error: 'Remote debugging is off. Launch with SPYGLASS_CDP=1.',
        guestUrl: snapshot.url
      };
    }
    const session = requireSession();
    const recorder = session.snapshot();
    if (recorder.state === 'recording' || recorder.state === 'stopping') {
      return {
        ok: false,
        llmCalls: 0,
        results: [],
        error: 'Stop recording before replaying with act().',
        guestUrl: snapshot.url
      };
    }
    await session.flushPendingCapture();
    const events = await session.readRawEvents();
    const replayed = events.filter((rawEvent) => {
      if (rawEvent.action === undefined || rawEvent.kind === 'step.retracted') {
        return false;
      }
      return !events.some(
        (other) => other.kind === 'step.retracted' && other.retracts === rawEvent.id
      );
    });
    const actions = replayed.flatMap((rawEvent) =>
      rawEvent.action === undefined ? [] : [toObserveResult(rawEvent.action, rawEvent.kind)]
    );
    const observeWin = winRef.current;
    if (observeWin !== undefined && !observeWin.isDestroyed()) {
      try {
        const targets = await fetchCdpTargets(cdpPort);
        pinChromeTargetFromList(observeWin.webContents, targets, snapshot.url);
      } catch {
        // pin is best-effort
      }
    }
    return await runStagehandAct({
      cdpUrl: cdpHttpUrl(cdpPort),
      guestUrl: snapshot.url,
      actions,
      appPath: app.getAppPath(),
      chromeTargetId: pinnedChromeTargetId
    });
  });

  ipcMain.on(IPC.layoutBrowserBounds, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.layoutBrowserBounds)) {
      return;
    }
    const payload = parseBrowserBoundsPayload(raw);
    if (payload === undefined) {
      console.error('Rejected invalid spyglass:layout:browserBounds payload');
      return;
    }
    const bounds = roundBrowserBounds(payload);
    if (bounds === undefined || activePane === undefined) {
      return;
    }
    const win = winRef.current;
    if (win === undefined || win.isDestroyed()) {
      return;
    }
    const size = win.getContentSize();
    const clamped = clampBrowserBoundsToChrome(bounds, size[0] ?? 0, size[1] ?? 0);
    if (clamped === undefined) {
      return;
    }
    activePane.setBounds(clamped);
  });

  ipcMain.handle(IPC.configGet, (event) => {
    if (rejectForeignIpc(event, winRef, IPC.configGet)) {
      return emptyConfig();
    }
    return observerRuntime?.settings.masked() ?? emptyConfig();
  });

  ipcMain.handle(IPC.configSet, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.configSet)) {
      return { ok: false, persistedKey: false, error: 'forbidden' };
    }
    const payload = parseConfigSetPayload(raw);
    if (payload === undefined || observerRuntime === undefined) {
      return { ok: false, persistedKey: false, error: 'invalid payload' };
    }
    const result = await observerRuntime.settings.apply(payload);
    const settings = observerRuntime.settings;
    observerRuntime.observer.configureBudget({
      ceiling: settings.sessionTokenLimitFast(),
      warnRatio: settings.tokenWarnRatio(),
      rateLimitPerMin: settings.rateLimitCallsPerMin()
    });
    if (isLlmOffline(process.env)) {
      observerRuntime.observer.setOffline(true);
    } else {
      observerRuntime.observer.setEnabled(settings.enrichmentEnabled());
    }
    activeRefine?.configureThreshold(settings.smartTokenConfirm());
    return result;
  });

  ipcMain.handle(IPC.configTest, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.configTest)) {
      return { ok: false, latencyMs: 0, multimodal: false, error: 'forbidden' };
    }
    const payload = parseConfigTestPayload(raw);
    if (payload === undefined || observerRuntime === undefined) {
      return { ok: false, latencyMs: 0, multimodal: false, error: 'invalid payload' };
    }
    return await observerRuntime.gateway.testConnection(payload.profile);
  });

  ipcMain.handle(IPC.usageRaiseCeiling, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.usageRaiseCeiling)) {
      return { ok: false };
    }
    if (observerRuntime === undefined) {
      return { ok: false };
    }
    const payload = parseRaiseCeilingPayload(raw);
    observerRuntime.observer.raiseCeiling(payload.tokens);
    return { ok: true };
  });

  ipcMain.on(IPC.layoutGuestVisible, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.layoutGuestVisible)) {
      return;
    }
    const payload = parseGuestVisiblePayload(raw);
    if (payload === undefined || activePane === undefined) {
      return;
    }
    activePane.setVisible(payload.visible);
  });

  ipcMain.handle(IPC.voiceStart, async (event, raw: unknown): Promise<VoiceStartResponse> => {
    if (rejectForeignIpc(event, winRef, IPC.voiceStart)) {
      return {
        ok: false,
        mode: 'hold',
        engine: 'mock',
        model: 'mock-offline',
        fakeCapture: true,
        error: 'forbidden'
      };
    }
    const payload = parseVoiceStartPayload(raw);
    if (payload === undefined || voiceBridge === undefined) {
      return {
        ok: false,
        mode: 'hold',
        engine: 'mock',
        model: 'mock-offline',
        fakeCapture: true,
        error: 'invalid payload'
      };
    }
    try {
      const status = await voiceBridge.startCapture(payload.mode);
      if (!voiceBridge.isCapturing()) {
        return {
          ok: false,
          mode: payload.mode,
          engine: status.engine,
          model: status.model,
          fakeCapture: status.fakeCapture,
          error: 'voice capture refused'
        };
      }
      return {
        ok: true,
        mode: payload.mode,
        engine: status.engine,
        model: status.model,
        fakeCapture: status.fakeCapture
      };
    } catch (error) {
      return {
        ok: false,
        mode: payload.mode,
        engine: 'mock',
        model: 'mock-offline',
        fakeCapture: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle(IPC.voiceStop, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.voiceStop)) {
      return { ok: false };
    }
    if (!parseEmptyPayload(raw)) {
      return { ok: false };
    }
    await voiceBridge?.stopCapture();
    return { ok: true };
  });

  ipcMain.handle(IPC.voiceAbort, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.voiceAbort)) {
      return { ok: false };
    }
    if (!parseEmptyPayload(raw)) {
      return { ok: false };
    }
    voiceBridge?.abort();
    return { ok: true };
  });

  ipcMain.handle(IPC.voiceSetMode, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.voiceSetMode)) {
      return { ok: false };
    }
    const payload = parseVoiceStartPayload(raw);
    if (payload === undefined) {
      return { ok: false };
    }
    voiceBridge?.setCaptureMode(payload.mode);
    return { ok: true, mode: payload.mode };
  });

  ipcMain.on(IPC.voiceFrame, (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.voiceFrame)) {
      return;
    }
    const frame = asPcmFrame(raw);
    if (frame === undefined) {
      return;
    }
    voiceBridge?.sendFrame(frame);
  });

  ipcMain.handle(IPC.voiceEdit, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.voiceEdit)) {
      return { ok: false };
    }
    const payload = parseVoiceEditPayload(raw);
    if (payload === undefined) {
      return { ok: false };
    }
    const edited = await requireSession().recordVoiceEdited(payload.eventId, payload.text);
    if (edited !== undefined) {
      try {
        const store = await ensureSttUpgradeStore();
        await store.recordCorrection();
        const modelDir = resolveSttModelDir();
        const snap = store.snapshot(modelDir);
        const win = winRef.current;
        if (win !== undefined && snap.decision === 'propose') {
          emitToChrome(win, IPC.sttUpgradeOffer, { propose: true });
        }
      } catch (error) {
        /* L7-022: upgrade bookkeeping must not fail voice-edit */
        /* L7-190: log/emit store failures instead of a silent discard */
        console.error(
          '[spyglass] STT upgrade bookkeeping failed:',
          error instanceof Error ? error.message : error
        );
      }
    }
    return { ok: edited !== undefined };
  });

  ipcMain.handle(
    IPC.refineEstimate,
    async (event, raw: unknown): Promise<RefineEstimateResponse> => {
      if (rejectForeignIpc(event, winRef, IPC.refineEstimate)) {
        return {
          ok: false,
          estimatedTokens: 0,
          threshold: 0,
          requiresConfirm: false,
          model: '',
          eventCount: 0,
          error: 'forbidden'
        };
      }
      if (activeRefine === undefined) {
        return {
          ok: false,
          estimatedTokens: 0,
          threshold: 0,
          requiresConfirm: false,
          model: '',
          eventCount: 0,
          error: 'refine engine missing'
        };
      }
      const payload = parseRefineEstimatePayload(raw);
      return await activeRefine.estimate(payload.aggressiveness ?? 'balanced');
    }
  );

  ipcMain.handle(IPC.refineRun, async (event, raw: unknown): Promise<RefineRunResponse> => {
    if (rejectForeignIpc(event, winRef, IPC.refineRun)) {
      return { ok: false, error: 'forbidden' };
    }
    const payload = parseRefineRunPayload(raw);
    if (payload === undefined || activeRefine === undefined) {
      return { ok: false, error: 'invalid payload' };
    }
    const result = await activeRefine.run(
      payload.aggressiveness ?? 'balanced',
      payload.confirm === true
    );
    emitRefineState(winRef);
    return result;
  });

  ipcMain.handle(IPC.refineConfirm, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.refineConfirm)) {
      return { ok: false, error: 'forbidden' };
    }
    const payload = parseRefineConfirmPayload(raw);
    if (payload === undefined || activeRefine === undefined) {
      return { ok: false, error: 'invalid payload' };
    }
    const result = await activeRefine.confirm(payload);
    emitRefineState(winRef);
    return result;
  });

  ipcMain.handle(IPC.refineEdit, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.refineEdit)) {
      return { ok: false, error: 'forbidden' };
    }
    const payload = parseRefineEditPayload(raw);
    if (payload === undefined || activeRefine === undefined) {
      return { ok: false, error: 'invalid payload' };
    }
    const result = await activeRefine.edit(payload.index, payload.intent ?? '');
    emitRefineState(winRef);
    return result;
  });

  ipcMain.handle(
    IPC.refineFinalize,
    async (event, raw: unknown): Promise<RefineFinalizeResponse> => {
      if (rejectForeignIpc(event, winRef, IPC.refineFinalize)) {
        return { ok: false, error: 'forbidden' };
      }
      if (!parseEmptyPayload(raw) || activeRefine === undefined) {
        return { ok: false, error: 'invalid payload' };
      }
      const result = await activeRefine.finalize();
      emitRefineState(winRef);
      return result;
    }
  );

  ipcMain.handle(IPC.refineGet, (event) => {
    if (rejectForeignIpc(event, winRef, IPC.refineGet)) {
      return undefined;
    }
    return activeRefine?.view();
  });

  ipcMain.handle(IPC.replayStart, async (event, raw: unknown): Promise<ReplayStartResponse> => {
    if (rejectForeignIpc(event, winRef, IPC.replayStart)) {
      return { ok: false, error: 'forbidden' };
    }
    if (activeReplay === undefined) {
      return { ok: false, error: 'replay engine missing' };
    }
    const payload = parseReplayStartPayload(raw);
    return await activeReplay.start(payload);
  });

  ipcMain.handle(IPC.replayNext, (event) => {
    if (rejectForeignIpc(event, winRef, IPC.replayNext)) {
      return { ok: false, error: 'forbidden' };
    }
    if (activeReplay === undefined) {
      return { ok: false, error: 'inactive' };
    }
    activeReplay.next();
    return { ok: true };
  });

  ipcMain.handle(IPC.replayStop, (event) => {
    if (rejectForeignIpc(event, winRef, IPC.replayStop)) {
      return { ok: false, error: 'forbidden' };
    }
    if (activeReplay === undefined) {
      return { ok: false, error: 'inactive' };
    }
    activeReplay.stop();
    return { ok: true };
  });

  ipcMain.handle(IPC.sessionExport, async (event) => {
    if (rejectForeignIpc(event, winRef, IPC.sessionExport)) {
      return { ok: false, error: 'forbidden' };
    }
    const sessionDir = activeSession?.currentSessionDir();
    if (sessionDir === undefined) {
      return { ok: false, error: 'no session' };
    }
    const destDir = await pickSessionDirectory(winRef.current, 'Exporter la session', true);
    if (destDir === undefined) {
      return { ok: false, error: 'cancelled' };
    }
    try {
      const exported = await exportSessionFolder(sessionDir, destDir);
      return { ok: true, dest: exported.dest, sessionId: exported.sessionId };
    } catch (error) {
      return { ok: false, error: sessionBundleIpcError(error, 'export-failed') };
    }
  });

  ipcMain.handle(IPC.sessionImport, async (event) => {
    if (rejectForeignIpc(event, winRef, IPC.sessionImport)) {
      return { ok: false, error: 'forbidden' };
    }
    const bundleDir = await pickSessionDirectory(winRef.current, 'Importer une session', false);
    if (bundleDir === undefined) {
      return { ok: false, error: 'cancelled' };
    }
    try {
      const imported = await importSessionFolder(
        bundleDir,
        sessionsDirFromEnv(app.getPath('userData'))
      );
      return { ok: true, sessionId: imported.sessionId, sessionDir: imported.sessionDir };
    } catch (error) {
      return { ok: false, error: sessionBundleIpcError(error, 'import-failed') };
    }
  });

  ipcMain.handle(IPC.sttUpgradeStatus, async (event) => {
    if (rejectForeignIpc(event, winRef, IPC.sttUpgradeStatus)) {
      return {
        correctionCount: 0,
        refusedPermanently: false,
        largeAvailable: false,
        propose: false,
        fallback: false
      };
    }
    try {
      const store = await ensureSttUpgradeStore();
      const modelDir = resolveSttModelDir();
      const snap = store.snapshot(modelDir);
      try {
        const fallback = await readLargeFallback(modelDir);
        return {
          correctionCount: snap.correctionCount,
          refusedPermanently: snap.refusedPermanently,
          largeAvailable: snap.largeAvailable,
          propose: snap.decision === 'propose',
          fallback
        };
      } catch {
        return {
          correctionCount: snap.correctionCount,
          refusedPermanently: snap.refusedPermanently,
          largeAvailable: snap.largeAvailable,
          propose: snap.decision === 'propose',
          fallback: false,
          error: 'fallback-unreadable'
        };
      }
    } catch {
      return {
        correctionCount: 0,
        refusedPermanently: false,
        largeAvailable: false,
        propose: false,
        fallback: false,
        error: 'store-unavailable'
      };
    }
  });

  ipcMain.handle(IPC.sttUpgradeDecide, async (event, raw: unknown) => {
    if (rejectForeignIpc(event, winRef, IPC.sttUpgradeDecide)) {
      return { ok: false, error: 'forbidden' };
    }
    const action = parseSttUpgradeDecide(raw);
    if (action === undefined) {
      return { ok: false, error: 'bad-request' };
    }
    return enqueueSttUpgradeDecide(async () => {
      let store: SttUpgradeStore;
      try {
        store = await ensureSttUpgradeStore();
        if (action === 'refuse') {
          await store.refusePermanently();
          return { ok: true };
        }
        if (store.snapshot(resolveSttModelDir()).refusedPermanently) {
          return { ok: false, error: 'refused' };
        }
      } catch {
        return { ok: false, error: 'store-unavailable' };
      }
      const modelDir = resolveSttModelDir();
      // L7-221: queued duplicate accepts / already-present large must not
      // re-fetch ~575MB; gate beyond refusedPermanently only.
      if (largeModelPresent(modelDir)) {
        return { ok: true };
      }
      try {
        await mkdir(modelDir, { recursive: true });
        const dest = largeModelPath(modelDir);
        if (sttUpgradeFakeEnabled(process.env, app.isPackaged)) {
          await writeFileAtomic(dest, Buffer.from(`${STT_LARGE_MODEL_FILE}\n`));
          return { ok: true };
        }
        await downloadUrlToFileAtomic({
          dest,
          url: STT_LARGE_MODEL_URL,
          timeoutMs: sttLargeDownloadTimeoutMs(process.env),
          expectedSha256: resolveSttLargeExpectedSha256(process.env, app.isPackaged),
          minBytes: STT_LARGE_MIN_BYTES
        });
        return { ok: true };
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { ok: false, error: timedOut ? 'timeout' : 'download-failed' };
      }
    });
  });
}

void (async () => {
  const cdpEnabled = isRemoteDebuggingRequested(process.env, app.isPackaged);
  const cdpPort = cdpEnabled ? await resolveCdpPort() : 0;
  if (cdpEnabled) {
    enableRemoteDebugging(cdpPort);
  }

  await app.whenReady();

  const winRef: { current: BrowserWindow | undefined } = { current: undefined };
  registerIpc(cdpPort, winRef);

  const createShell = (): void => {
    pinnedChromeTargetId = undefined;
    const win = createWindow();
    winRef.current = win;
    const runtimePromise = createObserverRuntime(win, () => requireSession()).then((runtime) => {
      observerRuntime = runtime;
      activeRefine = new RefineEngine({
        session: () => requireSession(),
        refine: async (events, aggressiveness) => runtime.gateway.refine(events, aggressiveness),
        model: () => runtime.settings.profileConfig('smart').model,
        confirmThreshold: () => runtime.settings.smartTokenConfirm(),
        offline: () => isLlmOffline(process.env),
        observe: async () => {
          const snapshot = requirePane().snapshot();
          if (cdpPort <= 0) {
            return { ok: false, observations: [] };
          }
          const result = await runStagehandObserve({
            cdpUrl: cdpHttpUrl(cdpPort),
            guestUrl: snapshot.url,
            instruction: 'Find interactive elements on the displayed page',
            appPath: app.getAppPath(),
            chromeTargetId: pinnedChromeTargetId
          });
          return { ok: result.ok, observations: result.observations };
        }
      });
      activeReplay = new ReplayEngine({
        session: () => requireSession(),
        driver: () => new ElectronPageDriver(requirePane().webContents, requirePane().resourcesDir),
        gateway: () => runtime.gateway,
        model: () => runtime.settings.profileConfig('smart').model,
        observe: async () => {
          const snapshot = requirePane().snapshot();
          if (cdpPort <= 0) {
            return { ok: false, observations: [] };
          }
          const result = await runStagehandObserve({
            cdpUrl: cdpHttpUrl(cdpPort),
            guestUrl: snapshot.url,
            instruction: 'Find the element for the failed step',
            appPath: app.getAppPath(),
            chromeTargetId: pinnedChromeTargetId
          });
          return { ok: result.ok, observations: result.observations };
        },
        onProgress: (event) => {
          const payload: ReplayProgressPayload = event;
          emitToChrome(win, IPC.replayProgress, payload);
          emitToChrome(win, IPC.chatMessage, {
            eventId: `replay_${event.runId}_${String(event.stepIndex)}_${event.status}_${String(event.attempt)}`,
            stepIndex: event.stepIndex,
            kind: 'replay.step',
            mode: 'system',
            text: `${event.mode} · ${event.status} · ${event.message}`,
            issuedAt: Date.now(),
            retractable: false
          });
        }
      });
      return runtime;
    });
    if (cdpPort > 0) {
      pinChromeFromWebContents(win.webContents);
    }
    const pane = new BrowserPane(
      win,
      {
        onState: (state: NavState) => {
          emitToChrome(win, IPC.navState, state);
          void persistCdpInfo(cdpPort, state.url, state.title, win.webContents).catch(
            (error: unknown) => {
              console.error('Failed to persist CDP info:', error);
            }
          );
        },
        onPopupRedirected: (payload: PopupRedirectedPayload) => {
          console.info('[spyglass] nav.popup-redirected', payload);
          emitToChrome(win, IPC.navPopupRedirected, payload);
          void activeSession?.recordPopup(payload.url);
        }
      },
      { cdpPort }
    );
    activePane = pane;
    activeSession = new SessionOrchestrator(
      () => sessionsDirFromEnv(app.getPath('userData')),
      () => requirePane(),
      {
        onEvent: (rawEvent) => {
          emitToChrome(win, IPC.eventAppended, rawEvent);
          observerRuntime?.observer.onRawEvent(rawEvent);
        },
        onState: (state: SessionStatePayload) => {
          emitToChrome(win, IPC.sessionState, state);
          emitRefineState(winRef);
          if (state.state === 'recording') {
            voiceBridge?.resumeCapture();
          }
        },
        onBeforeSeal: async () => {
          await observerRuntime?.observer.flush();
        },
        onBeforeStop: async () => {
          voiceBridge?.beginStop();
          await voiceBridge?.stopCapture();
        },
        onStopRolledBack: () => {
          voiceBridge?.resumeCapture();
        }
      }
    );
    activeSession.attachProbe();
    const sttEnv: NodeJS.ProcessEnv = { ...process.env };
    if (sttEnv.SPYGLASS_STT_RESOURCES === undefined || sttEnv.SPYGLASS_STT_RESOURCES.length === 0) {
      sttEnv.SPYGLASS_STT_RESOURCES = app.isPackaged
        ? join(process.resourcesPath, 'stt')
        : join(app.getAppPath(), '../../vendor/whisper');
    }
    voiceBridge = new VoiceBridge(
      {
        onPartial: (payload) => {
          emitToChrome(win, IPC.voicePartial, payload);
        },
        onFinal: (payload) => {
          if (payload.text.trim().length === 0) {
            return;
          }
          return requireSession()
            .recordVoiceFinal({
              text: payload.text,
              startTs: payload.startTs,
              endTs: payload.endTs,
              pcm: payload.pcm
            })
            .then((event) => {
              if (event === undefined) {
                return;
              }
              const message: VoiceFinalPayload = {
                eventId: event.id,
                utteranceId: payload.utteranceId,
                text: payload.text,
                startTs: payload.startTs,
                endTs: payload.endTs
              };
              if (event.voice?.relation !== undefined) {
                message.relation = event.voice.relation;
              }
              if (event.voice?.correlatedEventId !== undefined) {
                message.correlatedEventId = event.voice.correlatedEventId;
              }
              if (event.voice?.correlatedStepIndex !== undefined) {
                message.correlatedStepIndex = event.voice.correlatedStepIndex;
              }
              emitToChrome(win, IPC.voiceFinal, message);
            })
            .catch((error: unknown) => {
              console.error('Failed to journal voice.final:', error);
            });
        },
        onLevel: (rms) => {
          emitToChrome(win, IPC.voiceLevel, { rms });
        },
        onError: (message) => {
          console.error('[stt]', message);
        }
      },
      sttEnv,
      {
        canCapture: () => {
          const state = activeSession?.snapshot().state;
          return state === 'recording';
        }
      }
    );
    pane.webContents.on('did-navigate', () => {
      void activeSession?.recordNav('nav.load', pane.snapshot());
    });
    // SPA history is recorded by the guest probe (`nav.spa`), not did-navigate-in-page.
    const ses = pane.webContents.session;
    if (!netCompletedBound.has(ses)) {
      netCompletedBound.add(ses);
      ses.webRequest.onCompleted((details) => {
        const resourceType = String(details.resourceType);
        if (resourceType === 'xhr' || resourceType === 'fetch') {
          void activeSession?.recordNetRequest(details.url);
        }
      });
    }

    const applyFallbackBounds = (): void => {
      const size = win.getContentSize();
      pane.setBounds(fallbackBrowserBounds(size[0] ?? 1280, size[1] ?? 800));
    };

    applyFallbackBounds();

    win.once('ready-to-show', () => {
      void (async () => {
        observerRuntime = await runtimePromise;
        win.show();
        applyFallbackBounds();
        const startUrl = process.env.SPYGLASS_START_URL;
        if (startUrl !== undefined && startUrl.length > 0) {
          const normalized = normalizeGotoUrl(startUrl);
          if (normalized !== undefined) {
            await pane.goto(normalized);
          } else {
            await pane.loadStartPage();
          }
        } else {
          await pane.loadStartPage();
        }
        if (process.env.SPYGLASS_OBSERVE_ON_START === '1' && cdpPort > 0) {
          await waitForGuestPaint(pane.webContents);
          const snapshot = pane.snapshot();
          try {
            const targets = await fetchCdpTargets(cdpPort);
            pinChromeTargetFromList(win.webContents, targets, snapshot.url);
          } catch {
            // pin is best-effort
          }
          const result = await runStagehandObserve({
            cdpUrl: cdpHttpUrl(cdpPort),
            guestUrl: snapshot.url,
            instruction: process.env.SPYGLASS_OBSERVE_INSTRUCTION,
            appPath: app.getAppPath(),
            chromeTargetId: pinnedChromeTargetId
          });
          emitToChrome(win, IPC.stagehandResult, result);
          await persistObserveResultIfRequested(result);
          if (process.env.SPYGLASS_OBSERVE_REQUIRE_OK === '1' && !result.ok) {
            console.error('Packaged Observe smoke failed:', result.error);
            app.exit(1);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        await captureIfRequested(win, pane.webContents);
      })().catch((error: unknown) => {
        console.error('Shell startup failed:', error);
        quitAfterScreenshot(true);
      });
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (!app.isPackaged && devUrl !== undefined && devUrl.length > 0) {
      void win.loadURL(devUrl);
    } else {
      void win.loadFile(rendererIndexPath());
    }
  };

  createShell();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createShell();
    }
  });
})().catch((error: unknown) => {
  console.error('Failed to start Spyglass:', error);
  app.exit(1);
});

app.on('before-quit', () => {
  void voiceBridge?.dispose();
});

app.on('window-all-closed', () => {
  void voiceBridge?.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
