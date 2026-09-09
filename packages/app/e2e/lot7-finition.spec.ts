import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;

test.describe('Lot 7 chrome (F-47 / F-59 / F-38)', () => {
  test('replay pas-à-pas, export/import, and STT upgrade controls are present', async () => {
    test.setTimeout(60_000);
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
      await electronApp.close();
      await rm(userData, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

async function waitForChrome(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<import('@playwright/test').Page> {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
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
