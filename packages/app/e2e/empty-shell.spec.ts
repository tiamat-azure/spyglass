import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type Page, test } from '@playwright/test';

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
  env.SPYGLASS_CDP = '1';
  env.SPYGLASS_USER_DATA = userData;
  env.SPYGLASS_CDP_INFO = join(userData, 'cdp.json');
  return env;
}

async function waitForPage(
  electronApp: Awaited<ReturnType<typeof electron.launch>>,
  predicate: (page: Page) => Promise<boolean>,
  timeoutMs = 45_000
): Promise<Page> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const page of electronApp.windows()) {
      try {
        if (await predicate(page)) {
          return page;
        }
      } catch {
        // window may still be loading
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for Electron page');
}

async function chromeWindow(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<Page> {
  return await waitForPage(electronApp, async (page) => (await page.locator('#url').count()) > 0);
}

async function guestWindow(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<Page> {
  return await waitForPage(
    electronApp,
    async (page) => (await page.locator('#popup-link').count()) > 0
  );
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
      const chrome = await chromeWindow(electronApp);
      const guest = await guestWindow(electronApp);

      await expect(chrome).toHaveTitle(/Spyglass/);
      await expect(chrome.locator('h1')).toHaveText('Spyglass');
      await expect(chrome.locator('.tagline')).toContainText('Lot 7');
      await expect(chrome.locator('#url')).toBeVisible();
      await expect(chrome.locator('#back')).toBeVisible();
      await expect(chrome.locator('#forward')).toBeVisible();
      await expect(chrome.locator('#reload')).toBeVisible();
      await expect(chrome.locator('#browser-slot')).toBeVisible();
      await expect(chrome.locator('#chat')).toBeVisible();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i);
      await expect(chrome.locator('#rec-pill')).toBeVisible();
      await expect(chrome.locator('#versions')).toContainText(/Electron/i);
      await expect(guest.locator('h1')).toHaveText('Spyglass start page');

      await expect.poll(async () => chrome.locator('#url').inputValue()).toMatch(/start\.html/);

      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await chrome.screenshot({
          path: join(shotDir, 'e2e-two-zone-shell.png')
        });
        await guest.screenshot({
          path: join(shotDir, 'guest-start-page.png')
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
      const chrome = await chromeWindow(electronApp);
      const guest = await guestWindow(electronApp);

      await guest.locator('#popup-link').click();
      await expect(chrome.locator('#log')).toContainText('nav.popup-redirected');
      await expect(guest.locator('#popup-target')).toBeVisible();

      await chrome.locator('#url').fill('https://example.com');
      await chrome.locator('#url-form').evaluate((form) => {
        if (form instanceof HTMLFormElement) {
          form.requestSubmit();
        }
      });

      await expect
        .poll(async () => chrome.locator('#url').inputValue(), { timeout: 20_000 })
        .toMatch(/example\.com/);

      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await guest.screenshot({
          path: join(shotDir, 'navigated-webcontentsview.png')
        });
      }

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

  test('Stagehand observe attaches to the displayed page', async () => {
    test.setTimeout(120_000);
    const env = await launchEnv();
    const electronApp = await electron.launch({
      cwd: appDir,
      args: ['--no-sandbox', '--no-zygote', appDir],
      executablePath: bundledElectron,
      timeout: 45_000,
      env
    });

    try {
      const chrome = await chromeWindow(electronApp);
      await guestWindow(electronApp);
      await chrome.locator('#observe').click();
      await expect(chrome.locator('#log')).toContainText(/observe/i, { timeout: 90_000 });

      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await chrome.screenshot({
          path: join(shotDir, 'stagehand-observe.png')
        });
      }
    } finally {
      await electronApp.close();
    }
  });
});
