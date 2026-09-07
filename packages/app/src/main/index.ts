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
import { cdpHttpUrl, enableRemoteDebugging, resolveCdpPort } from './cdp-port.ts';
import { parseCdpTargetList, pickGuestTarget } from './cdp-targets.ts';
import {
  parseBrowserBoundsPayload,
  parseEmptyPayload,
  parseGotoPayload,
  parseObservePayload
} from './ipc-validate.ts';
import { fallbackBrowserBounds, roundBrowserBounds } from './layout.ts';
import { normalizeGotoUrl } from './nav-url.ts';
import { runStagehandObserve } from './stagehand-bridge.ts';

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

let activePane: BrowserPane | undefined;
let ipcRegistered = false;

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

async function persistCdpInfo(port: number, guestUrl: string, guestTitle: string): Promise<void> {
  const path = cdpInfoPath();
  if (path === undefined) {
    return;
  }
  let target: ReturnType<typeof pickGuestTarget>;
  try {
    const targets = await fetchCdpTargets(port);
    target = pickGuestTarget(targets, guestUrl);
  } catch {
    target = undefined;
  }
  await writeCdpInfoFile(path, infoFromTarget(port, guestUrl, guestTitle, target));
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

function registerIpc(cdpPort: number, winRef: { current: BrowserWindow | undefined }): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle(IPC.navGoto, async (_event, raw: unknown) => {
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

  ipcMain.handle(IPC.navBack, (_event, raw: unknown) => {
    if (!parseEmptyPayload(raw)) {
      console.error('Rejected invalid spyglass:nav:back payload');
      return { ok: false };
    }
    requirePane().back();
    return { ok: true };
  });

  ipcMain.handle(IPC.navForward, (_event, raw: unknown) => {
    if (!parseEmptyPayload(raw)) {
      console.error('Rejected invalid spyglass:nav:forward payload');
      return { ok: false };
    }
    requirePane().forward();
    return { ok: true };
  });

  ipcMain.handle(IPC.navReload, (_event, raw: unknown) => {
    if (!parseEmptyPayload(raw)) {
      console.error('Rejected invalid spyglass:nav:reload payload');
      return { ok: false };
    }
    requirePane().reload();
    return { ok: true };
  });

  ipcMain.handle(IPC.stagehandCdp, async (): Promise<StagehandCdpResponse> => {
    const snapshot = requirePane().snapshot();
    let targetId: string | undefined;
    try {
      const targets = await fetchCdpTargets(cdpPort);
      targetId = pickGuestTarget(targets, snapshot.url)?.id;
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

  ipcMain.handle(IPC.stagehandObserve, async (_event, raw: unknown) => {
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
    const result = await runStagehandObserve({
      cdpUrl: cdpHttpUrl(cdpPort),
      guestUrl: snapshot.url,
      instruction: payload.instruction
    });
    const win = winRef.current;
    if (win !== undefined) {
      emitToChrome(win, IPC.stagehandResult, result);
    }
    return result;
  });

  ipcMain.on(IPC.layoutBrowserBounds, (_event, raw: unknown) => {
    const payload = parseBrowserBoundsPayload(raw);
    if (payload === undefined) {
      console.error('Rejected invalid spyglass:layout:browserBounds payload');
      return;
    }
    const bounds = roundBrowserBounds(payload);
    if (bounds === undefined || activePane === undefined) {
      return;
    }
    activePane.setBounds(bounds);
  });
}

void (async () => {
  const cdpPort = await resolveCdpPort();
  enableRemoteDebugging(cdpPort);

  await app.whenReady();

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  const winRef: { current: BrowserWindow | undefined } = { current: undefined };
  registerIpc(cdpPort, winRef);

  const createShell = (): void => {
    const win = createWindow();
    winRef.current = win;
    const pane = new BrowserPane(win, {
      onState: (state: NavState) => {
        emitToChrome(win, IPC.navState, state);
        void persistCdpInfo(cdpPort, state.url, state.title).catch((error: unknown) => {
          console.error('Failed to persist CDP info:', error);
        });
      },
      onPopupRedirected: (payload: PopupRedirectedPayload) => {
        console.info('[spyglass] nav.popup-redirected', payload);
        emitToChrome(win, IPC.navPopupRedirected, payload);
      }
    });
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
        if (process.env.SPYGLASS_OBSERVE_ON_START === '1') {
          await waitForGuestPaint(pane.webContents);
          const snapshot = pane.snapshot();
          const result = await runStagehandObserve({
            cdpUrl: cdpHttpUrl(cdpPort),
            guestUrl: snapshot.url,
            instruction: process.env.SPYGLASS_OBSERVE_INSTRUCTION
          });
          emitToChrome(win, IPC.stagehandResult, result);
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        await captureIfRequested(win, pane.webContents);
      })().catch((error: unknown) => {
        console.error('Shell startup failed:', error);
        quitAfterScreenshot(true);
      });
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl !== undefined && devUrl.length > 0) {
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
