import { spawnSync } from 'node:child_process';

/** Playwright `electronApp.close()` waits for `app.quit()` / process exit. */
const CLOSE_TIMEOUT_MS = 12_000;
/** L7-103: brief wait after SIGKILL so `rm(userData)` is not racing the process. */
export const KILL_EXIT_GRACE_MS = 2_000;

export type ElectronChild = {
  kill: (signal?: NodeJS.Signals) => boolean;
  killed?: boolean;
  exitCode?: number | null;
  pid?: number;
  once?: (event: 'exit', listener: () => void) => unknown;
};

type LaunchedElectron = {
  close: () => Promise<void>;
  process: () => ElectronChild | null | undefined;
};

/**
 * Close a launched Electron app, then SIGKILL if quit hangs.
 *
 * On macOS, `window-all-closed` does not quit (desktop dock behavior), and a
 * guest `WebContentsView` that navigated off-origin (or a denied `target=_blank`
 * popup) can leave Playwright waiting on close until the worker teardown
 * timeout. Lot 3 already used this pattern; CI macOS e2e needs it everywhere.
 */
export async function closeElectron(electronApp: LaunchedElectron): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // L7-142: keep a no-op handler so a late reject after timeout+SIGKILL is not unhandled.
  const closing = electronApp.close();
  void closing.catch(() => {});
  try {
    await Promise.race([
      closing,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('electron close timeout'));
        }, CLOSE_TIMEOUT_MS);
        timer.unref();
      })
    ]);
  } catch {
    const child = electronApp.process();
    killElectronChild(child);
    await waitForProcessExit(child);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * SIGKILL the Electron child. On Windows, `kill('SIGKILL')` does not tear down
 * the renderer/GPU tree and Playwright's worker teardown then waits 60s.
 */
export function killElectronChild(child: ElectronChild | null | undefined): void {
  if (child === undefined || child === null) {
    return;
  }
  if (process.platform === 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }
  child.kill('SIGKILL');
}

/** L7-117: `killed` only means kill() was called; wait until exitCode or grace. */
export async function waitForProcessExit(child: ElectronChild | null | undefined): Promise<void> {
  if (child === undefined || child === null) {
    return;
  }
  if (child.exitCode !== undefined && child.exitCode !== null) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      if (typeof child.once === 'function') {
        child.once('exit', () => {
          resolve();
        });
      }
      // L7-158: missing once — do not resolve; the grace timeout still applies.
    }),
    new Promise<void>((resolve) => {
      const grace = setTimeout(resolve, KILL_EXIT_GRACE_MS);
      grace.unref();
    })
  ]);
}
