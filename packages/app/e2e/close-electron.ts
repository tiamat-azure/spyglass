/** Playwright `electronApp.close()` waits for `app.quit()` / process exit. */
const CLOSE_TIMEOUT_MS = 12_000;
/** L7-103: brief wait after SIGKILL so `rm(userData)` is not racing the process. */
const KILL_EXIT_GRACE_MS = 2_000;

type ElectronChild = {
  kill: (signal?: NodeJS.Signals) => boolean;
  killed?: boolean;
  exitCode?: number | null;
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
  try {
    await Promise.race([
      electronApp.close(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('electron close timeout'));
        }, CLOSE_TIMEOUT_MS);
        timer.unref();
      })
    ]);
  } catch {
    const child = electronApp.process();
    child?.kill('SIGKILL');
    await waitForProcessExit(child);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function waitForProcessExit(child: ElectronChild | null | undefined): Promise<void> {
  if (child === undefined || child === null) {
    return;
  }
  if (child.killed === true || (child.exitCode !== undefined && child.exitCode !== null)) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      if (typeof child.once === 'function') {
        child.once('exit', () => {
          resolve();
        });
        return;
      }
      resolve();
    }),
    new Promise<void>((resolve) => {
      const grace = setTimeout(resolve, KILL_EXIT_GRACE_MS);
      grace.unref();
    })
  ]);
}
