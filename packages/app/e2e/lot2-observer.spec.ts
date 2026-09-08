import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type Page, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;
const shotDir =
  process.env.SPYGLASS_E2E_SCREENSHOT_DIR ?? join(appDir, '../../docs/lot-2/screenshots');

async function launchEnv(overrides: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-lot2-'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  env.SPYGLASS_DISABLE_GPU = '1';
  env.SPYGLASS_NO_SANDBOX = '1';
  env.SPYGLASS_CDP = '1';
  env.SPYGLASS_USER_DATA = userData;
  env.SPYGLASS_CDP_INFO = join(userData, 'cdp.json');
  env.SESSIONS_DIR = join(userData, 'sessions');
  env.SPYGLASS_GUEST_PAGE = 'lot1-fixture.html';
  env.SPYGLASS_LLM_TRANSPORT = 'mock';
  env.LLM_FAST_BATCH_MS = '40';
  env.SPYGLASS_LLM_MOCK_DELAY_MS = '60';
  env.SPYGLASS_E2E_SCREENSHOT_DIR = shotDir;
  Object.assign(env, overrides);
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
  return await waitForPage(
    electronApp,
    async (page) => (await page.locator('#record-btn').count()) > 0
  );
}

async function guestWindow(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<Page> {
  return await waitForPage(
    electronApp,
    async (page) => (await page.locator('#step-1').count()) > 0
  );
}

async function latestRawJsonl(sessionsDir: string): Promise<string> {
  const sessions = await readdir(sessionsDir);
  const sessionId = sessions.sort().at(-1);
  if (sessionId === undefined) {
    throw new Error('No sessions written');
  }
  return await readFile(join(sessionsDir, sessionId, 'raw.jsonl'), 'utf8');
}

test.describe('Lot 2 observer', () => {
  test('gabarit paints under 200ms then enrichment replaces in place', async () => {
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
      const guest = await guestWindow(electronApp);
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i, { timeout: 15_000 });
      await guest.locator('#step-1').click();
      const msg = chrome.locator('#log li.chat-msg[data-kind="dom.click"]').first();
      await expect(msg).toBeVisible({ timeout: 15_000 });
      await expect(msg).toContainText(/Tu as cliqué/i);
      const latency = Number(await msg.getAttribute('data-latency-ms'));
      expect(latency).toBeLessThan(200);
      await chrome.screenshot({ path: join(shotDir, 'gabarit-under-200ms.png') });
      await expect(msg).toHaveAttribute('data-mode', 'llm', { timeout: 10_000 });
      await expect(msg.locator('.mode-pill')).toHaveText(/enrichi/i);
      await chrome.screenshot({ path: join(shotDir, 'enrichment-replace-in-place.png') });
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 15_000 });
    } finally {
      await electronApp.close();
    }
  });

  test('offline / enrichment disabled keeps a complete gabarit chat with no event loss', async () => {
    test.setTimeout(120_000);
    const env = await launchEnv({
      SPYGLASS_LLM_OFFLINE: '1',
      SPYGLASS_LLM_TRANSPORT: 'offline'
    });
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
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i, { timeout: 15_000 });
      await guest.locator('#step-1').click();
      await guest.locator('#step-2').fill('Ada');
      await guest.locator('#step-2').blur();
      await guest.locator('#step-6').click();
      await expect(chrome.locator('#log')).toContainText(/Tu as cliqué/i, { timeout: 15_000 });
      await expect(chrome.locator('#log')).toContainText(/Tu as saisi/i);
      await expect(chrome.locator('#log li.chat-msg[data-mode="llm"]')).toHaveCount(0);
      await chrome.screenshot({ path: join(shotDir, 'offline-gabarits.png') });
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 15_000 });
      const sessionsDir = env.SESSIONS_DIR;
      if (sessionsDir === undefined) {
        throw new Error('SESSIONS_DIR missing');
      }
      const jsonl = await latestRawJsonl(sessionsDir);
      expect(jsonl).toContain('record.start');
      expect(jsonl).toContain('dom.click');
      expect(jsonl).toContain('dom.input');
      expect(jsonl).toContain('record.stop');
      expect(jsonl).not.toContain('"mode": "llm"');
    } finally {
      await electronApp.close();
    }
  });

  test('lowered token ceiling warns then suspends enrichment while recording continues', async () => {
    test.setTimeout(120_000);
    const env = await launchEnv({
      SESSION_TOKEN_LIMIT_FAST: '100',
      SPYGLASS_LLM_MOCK_TOKENS: '80',
      TOKEN_WARN_RATIO: '0.5'
    });
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
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i, { timeout: 15_000 });
      await guest.locator('#step-1').click();
      await guest.locator('#step-6').click();
      await guest.locator('#step-10').click();
      await expect(chrome.locator('#log')).toContainText(/Attention/i, { timeout: 20_000 });
      await expect(chrome.locator('#log')).toContainText(/Plafond de tokens atteint/i, {
        timeout: 20_000
      });
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i);
      await expect(chrome.locator('#rec-pill')).toHaveAttribute('data-active', 'true');
      await chrome.screenshot({
        path: join(shotDir, 'suspended-enrichment-recording-continues.png')
      });
      await chrome.locator('#tab-settings').click();
      await expect(chrome.locator('#settings-panel')).toBeVisible();
      await expect(chrome.locator('#fast-model')).toHaveValue(/claude-haiku-4-5-20251001/);
      await chrome.screenshot({ path: join(shotDir, 'f29-settings-safestorage.png') });
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 15_000 });
    } finally {
      await electronApp.close();
    }
  });
});
