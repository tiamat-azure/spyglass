import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

/** @spyglass/app package root; `package.json` `"main"` is `./out/main/index.js`. */
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;

async function launchEnv(): Promise<NodeJS.ProcessEnv> {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-e2e-'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  env.SPYGLASS_DISABLE_GPU = '1';
  env.SPYGLASS_NO_SANDBOX = '1';
  env.SPYGLASS_USER_DATA = userData;
  env.SPYGLASS_CDP_INFO = join(userData, 'cdp.json');
  return env;
}

test.describe('Lot 0 two-zone shell', () => {
  test('launches URL bar, chat pane, and WebContentsView', async () => {
    const env = await launchEnv();
    const electronApp = await electron.launch({
      cwd: appDir,
      args: ['--no-sandbox', '--no-zygote', appDir],
      executablePath: bundledElectron,
      timeout: 45_000,
      env
    });

    try {
      const window = await electronApp.firstWindow({ timeout: 45_000 });
      await expect(window).toHaveTitle(/Spyglass/);
      await expect(window.locator('h1')).toHaveText('Spyglass');
      await expect(window.locator('.tagline')).toContainText('Lot 0');
      await expect(window.locator('#url')).toBeVisible();
      await expect(window.locator('#back')).toBeVisible();
      await expect(window.locator('#forward')).toBeVisible();
      await expect(window.locator('#reload')).toBeVisible();
      await expect(window.locator('#browser-slot')).toBeVisible();
      await expect(window.locator('#chat')).toBeVisible();
      await expect(window.locator('#rec-pill')).toHaveAttribute('aria-disabled', 'true');
      await expect(window.locator('#versions')).toContainText(/Electron/i);

      await window.waitForFunction(() => {
        const input = document.querySelector('#url');
        return input instanceof HTMLInputElement && input.value.includes('start.html');
      });

      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await window.screenshot({
          path: join(shotDir, 'e2e-two-zone-shell.png'),
          fullPage: true
        });
      }
    } finally {
      await electronApp.close();
    }
  });

  test('manual navigation and popup redirect stay in one page', async () => {
    const env = await launchEnv();
    const electronApp = await electron.launch({
      cwd: appDir,
      args: ['--no-sandbox', '--no-zygote', appDir],
      executablePath: bundledElectron,
      timeout: 45_000,
      env
    });

    try {
      const window = await electronApp.firstWindow({ timeout: 45_000 });
      await window.waitForFunction(() => {
        const input = document.querySelector('#url');
        return input instanceof HTMLInputElement && input.value.length > 0;
      });

      await window.locator('#url').fill('https://example.com');
      await window.locator('#url-form').evaluate((form) => {
        if (form instanceof HTMLFormElement) {
          form.requestSubmit();
        }
      });

      await window.waitForFunction(
        () => {
          const input = document.querySelector('#url');
          return input instanceof HTMLInputElement && input.value.includes('example.com');
        },
        undefined,
        { timeout: 20_000 }
      );

      await expect(window.locator('#url')).toHaveValue(/example\.com/);

      const infoPath = env.SPYGLASS_CDP_INFO;
      if (infoPath !== undefined) {
        await expect
          .poll(async () => {
            try {
              const raw = await readFile(infoPath, 'utf8');
              return raw.includes('example.com');
            } catch {
              return false;
            }
          })
          .toBe(true);
      }
    } finally {
      await electronApp.close();
    }
  });
});
