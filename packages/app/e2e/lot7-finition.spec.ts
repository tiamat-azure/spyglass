import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { CLOSE_TIMEOUT_MS, closeElectron, KILL_EXIT_GRACE_MS } from './close-electron.ts';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;
/** L7-279: waitForChrome budget; must stay in the test timeout formula. */
const CHROME_WAIT_MS = 45_000;
/** Margin covers electron.launch (45s) so a chrome miss can still close/kill. */
const TEST_TIMEOUT_MARGIN_MS = 45_000;

test.describe('Lot 7 chrome (F-47 / F-59 / F-38)', () => {
  test('replay pas-à-pas, export/import, and STT upgrade controls are present', async () => {
    // L7-279: chrome wait + close timeout + kill grace + margin (not the 60s default).
    test.setTimeout(
      CHROME_WAIT_MS + CLOSE_TIMEOUT_MS + KILL_EXIT_GRACE_MS + TEST_TIMEOUT_MARGIN_MS
    );
    const userData = await mkdtemp(join(tmpdir(), 'spyglass-lot7-e2e-'));
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ELECTRON_RENDERER_URL;
    env.SPYGLASS_DISABLE_GPU = '1';
    env.SPYGLASS_NO_SANDBOX = '1';
    env.SPYGLASS_USER_DATA = userData;
    env.SPYGLASS_LLM_TRANSPORT = 'mock';
    const electronApp = await electron.launch({
      executablePath: bundledElectron,
      args: [appDir],
      env,
      timeout: 45_000
    });
    try {
      const chrome = await waitForChrome(electronApp);
      await expect(chrome.locator('.tagline')).toContainText('Lot 7');
      await expect(chrome.locator('#replay-stepwise')).toHaveCount(1);
      await expect(chrome.locator('#replay-dataset')).toHaveCount(1);
      await expect(chrome.locator('#replay-next')).toHaveCount(1);
      await expect(chrome.locator('#replay-halt')).toHaveCount(1);
      await expect(chrome.locator('#session-export')).toHaveCount(1);
      await expect(chrome.locator('#session-import')).toHaveCount(1);
      await expect(chrome.locator('#stt-upgrade-accept')).toHaveCount(1);
      await expect(chrome.locator('#stt-upgrade-refuse')).toHaveCount(1);
      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await chrome.evaluate(() => {
          document.getElementById('refine-panel')?.removeAttribute('hidden');
          document.getElementById('replay-panel')?.removeAttribute('hidden');
          document.getElementById('stt-upgrade')?.removeAttribute('hidden');
        });
        await chrome.screenshot({ path: join(shotDir, 'chrome-lot7-controls.png') });
      }
    } finally {
      await closeElectron(electronApp);
      await rm(userData, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

async function waitForChrome(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<import('@playwright/test').Page> {
  const started = Date.now();
  while (Date.now() - started < CHROME_WAIT_MS) {
    for (const page of electronApp.windows()) {
      try {
        if ((await page.locator('#record-btn').count()) > 0) {
          return page;
        }
      } catch {
        // still loading
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for Electron chrome');
}
