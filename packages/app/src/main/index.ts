import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

/**
 * Lot -1 empty Electron shell.
 * No WebContentsView split, Stagehand, recording, chat, or voice — those are Lot 0+.
 */

if (process.platform === 'linux' || process.env.SPYGLASS_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

if (process.env.SPYGLASS_NO_SANDBOX === '1' || process.env.CI === 'true') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('no-zygote');
}

function preloadPath(): string {
  return join(import.meta.dirname, '../preload/index.cjs');
}

function rendererIndexPath(): string {
  return join(import.meta.dirname, '../renderer/index.html');
}

async function captureIfRequested(win: BrowserWindow): Promise<void> {
  const out = process.env.SPYGLASS_SCREENSHOT_PATH;
  if (out === undefined || out.length === 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await win.capturePage();
  await writeFile(out, image.toPNG());
  if (process.env.SPYGLASS_SCREENSHOT_EXIT === '1') {
    app.quit();
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
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

  win.once('ready-to-show', () => {
    win.show();
    void captureIfRequested(win);
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl !== undefined && devUrl.length > 0) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(rendererIndexPath());
  }

  return win;
}

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
