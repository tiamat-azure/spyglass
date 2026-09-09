/** Playwright `electronApp.close()` waits for `app.quit()` / process exit. */
const CLOSE_TIMEOUT_MS = 12_000;

type LaunchedElectron = {
  close: () => Promise<void>;
  process: () => { kill: (signal?: NodeJS.Signals) => boolean } | null | undefined;
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
  try {
    await Promise.race([
      electronApp.close(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('electron close timeout')), CLOSE_TIMEOUT_MS);
      })
    ]);
  } catch {
    electronApp.process()?.kill('SIGKILL');
  }
}
