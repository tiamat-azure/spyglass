import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import type {
  NavState,
  PopupRedirectedPayload,
  StagehandCdpResponse,
  StagehandObserveResponse
} from '../shared/ipc.ts';
import { IPC } from '../shared/ipc.ts';
import { BrowserPane } from './browser-pane.ts';
import { infoFromTarget, writeCdpInfoFile } from './cdp-info.ts';
import { isRemoteDebuggingRequested } from './cdp-policy.ts';
import { cdpHttpUrl, enableRemoteDebugging, resolveCdpPort } from './cdp-port.ts';
import { parseCdpTargetList, pickGuestTarget, resolvePinnedChromeTargetId } from './cdp-targets.ts';
import { isChromeIpcSender } from './ipc-sender.ts';
import {
  parseBrowserBoundsPayload,
  parseEmptyPayload,
  parseGotoPayload,
  parseObservePayload
} from './ipc-validate.ts';
import { clampBrowserBoundsToChrome, fallbackBrowserBounds, roundBrowserBounds } from './layout.ts';
import { normalizeGotoUrl } from './nav-url.ts';
import { runStagehandObserve } from './stagehand-bridge.ts';
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
let ipcRegistered = false;
let pinnedChromeTargetId: string | undefined;

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
        }
      },
      { cdpPort }
    );
    activePane = pane;

    const applyFallbackBounds = (): void => {
      const size = win.getContentSize();
      pane.setBounds(fallbackBrowserBounds(size[0] ?? 1280, size[1] ?? 800));
    };

    applyFallbackBounds();

    win.once('ready-to-show', () => {
      win.show();
      applyFallbackBounds();
      void (async () => {
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
