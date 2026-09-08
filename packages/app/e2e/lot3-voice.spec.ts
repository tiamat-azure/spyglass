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
  process.env.SPYGLASS_E2E_SCREENSHOT_DIR ?? join(appDir, '../../docs/lot-3/screenshots');

async function launchEnv(overrides: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-lot3-'));
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
  env.SPYGLASS_STT_ENGINE = 'mock';
  env.SPYGLASS_VOICE_FAKE = '1';
  env.SPYGLASS_STT_IN_PROCESS = '1';
  env.SPYGLASS_STT_MOCK_TRANSCRIPTS = "Je vais cliquer sur Démarrer|J'ai validé l'étape";
  env.AUDIO_RETENTION = 'none';
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
    async (page) => (await page.locator('#mic-btn').count()) > 0
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

async function latestSessionDir(sessionsDir: string): Promise<string> {
  const sessions = await readdir(sessionsDir);
  const sessionId = sessions.sort().at(-1);
  if (sessionId === undefined) {
    throw new Error('No sessions written');
  }
  return join(sessionsDir, sessionId);
}

async function closeElectron(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<void> {
  try {
    await Promise.race([
      electronApp.close(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('electron close timeout')), 12_000);
      })
    ]);
  } catch {
    electronApp.process()?.kill('SIGKILL');
  }
}

async function holdMic(chrome: Page, ms: number): Promise<void> {
  const mic = chrome.locator('#mic-btn');
  await mic.scrollIntoViewIfNeeded();
  const box = await mic.boundingBox();
  if (box === null) {
    throw new Error('#mic-btn has no box');
  }
  await chrome.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await chrome.mouse.down();
  await expect(chrome.locator('#voice-live')).toBeVisible({ timeout: 15_000 });
  await chrome.waitForTimeout(ms);
  await chrome.mouse.up();
  await expect(chrome.locator('#voice-live')).toHaveAttribute('data-kind', 'voice.final', {
    timeout: 10_000
  });
}

test.describe('Lot 3 voice', () => {
  test('hold/VAD UI, partial→final, before/after correlation, no raw audio', async () => {
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
      await expect(chrome.locator('#mic-btn')).toBeVisible();
      await expect(chrome.locator('#voice-mode')).toHaveText(/Hold/i);
      await chrome.screenshot({ path: join(shotDir, 'hold-vad-ui.png') });
      await chrome.locator('#voice-mode').click();
      await expect(chrome.locator('#voice-mode')).toHaveText(/VAD/i);
      await chrome.locator('#voice-mode').click();
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i, { timeout: 15_000 });
      await holdMic(chrome, 700);
      await expect(chrome.locator('#voice-live')).toBeVisible({ timeout: 10_000 });
      await expect(chrome.locator('#voice-live')).toHaveAttribute(
        'data-kind',
        /voice\.(partial|final)/
      );
      await chrome.screenshot({ path: join(shotDir, 'partial-to-final.png') });
      await expect(chrome.locator('#log li.chat-msg[data-kind="voice.final"]')).toHaveCount(1, {
        timeout: 10_000
      });
      await expect(
        chrome.locator('#log li.chat-msg[data-kind="voice.final"]').first()
      ).toHaveAttribute('data-relation', 'before');
      await guest.locator('#step-1').click();
      await expect(chrome.locator('#log li.chat-msg[data-kind="dom.click"]')).toBeVisible({
        timeout: 10_000
      });
      await holdMic(chrome, 700);
      await expect(chrome.locator('#log li.chat-msg[data-kind="voice.final"]')).toHaveCount(2, {
        timeout: 10_000
      });
      const after = chrome.locator('#log li.chat-msg[data-kind="voice.final"]').nth(1);
      await expect(after).toHaveAttribute('data-relation', 'after');
      await expect(chrome.locator('#log')).toContainText(/avant l'action/i);
      await expect(chrome.locator('#log')).toContainText(/après l'action/i);
      await chrome.screenshot({ path: join(shotDir, 'before-after-correlation.png') });
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 15_000 });
      const sessionsDir = env.SESSIONS_DIR;
      if (sessionsDir === undefined) {
        throw new Error('SESSIONS_DIR missing');
      }
      const sessionDir = await latestSessionDir(sessionsDir);
      const raw = await readFile(join(sessionDir, 'raw.jsonl'), 'utf8');
      expect(raw).toContain('"kind":"voice.final"');
      expect(raw).toContain('"relation":"before"');
      expect(raw).toContain('"relation":"after"');
      expect(raw).toContain('Je vais cliquer sur Démarrer');
      expect(raw).toContain("J'ai validé l'étape");
      expect(raw).toContain('"audioRef":null');
      const names = await readdir(sessionDir);
      expect(names).not.toContain('audio');
    } finally {
      await closeElectron(electronApp);
    }
  });

  test('offline dictation works with the network cut', async () => {
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
      await holdMic(chrome, 700);
      await guest.locator('#step-1').click();
      await holdMic(chrome, 700);
      await expect(chrome.locator('#log li.chat-msg[data-kind="voice.final"]')).toHaveCount(2, {
        timeout: 10_000
      });
      await expect(chrome.locator('#log li.chat-msg[data-mode="llm"]')).toHaveCount(0);
      await expect(chrome.locator('#token-hint')).toContainText(/offline/i);
      await chrome.screenshot({ path: join(shotDir, 'offline-dictation.png') });
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 15_000 });
      const sessionsDir = env.SESSIONS_DIR;
      if (sessionsDir === undefined) {
        throw new Error('SESSIONS_DIR missing');
      }
      const sessionDir = await latestSessionDir(sessionsDir);
      const raw = await readFile(join(sessionDir, 'raw.jsonl'), 'utf8');
      expect(raw).toContain('"kind":"voice.final"');
      expect(raw).not.toMatch(/"mode": "llm"/);
    } finally {
      await closeElectron(electronApp);
    }
  });
});
