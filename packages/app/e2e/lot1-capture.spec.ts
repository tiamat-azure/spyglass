import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type Page, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;

async function launchEnv(): Promise<NodeJS.ProcessEnv> {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-lot1-'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  env.SPYGLASS_DISABLE_GPU = '1';
  env.SPYGLASS_NO_SANDBOX = '1';
  env.SPYGLASS_CDP = '1';
  env.SPYGLASS_USER_DATA = userData;
  env.SPYGLASS_CDP_INFO = join(userData, 'cdp.json');
  env.SESSIONS_DIR = join(userData, 'sessions');
  env.SPYGLASS_GUEST_PAGE = 'lot1-fixture.html';
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
  if (sessions.length === 0) {
    throw new Error('No sessions written');
  }
  const sessionId = sessions.sort().at(-1);
  if (sessionId === undefined) {
    throw new Error('No session id');
  }
  return await readFile(join(sessionsDir, sessionId, 'raw.jsonl'), 'utf8');
}

test.describe('Lot 1 capture', () => {
  test('Record/Stop UI, 10-action fixture, retract, and act() without LLM', async () => {
    test.setTimeout(180_000);
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

      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i);
      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await chrome.screenshot({ path: join(shotDir, 'record-stop-ui.png') });
      }

      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i, { timeout: 15_000 });
      await expect(chrome.locator('#rec-pill')).toHaveAttribute('data-active', 'true');
      await new Promise((resolve) => setTimeout(resolve, 400));

      await guest.locator('#step-1').click();
      await guest.locator('#step-2').fill('Ada');
      await guest.locator('#step-2').blur();
      await guest.locator('#step-3').fill('hunter2');
      await guest.locator('#step-3').blur();
      await guest.locator('#step-4').selectOption('alpha');
      await guest.locator('#step-5').check();
      await guest.locator('#step-5').uncheck();
      await guest.locator('#step-6').click();
      await guest.evaluate(() => window.scrollBy(0, 260));
      await guest.locator('#step-8').fill('ok');
      await guest.locator('#step-8').press('Enter');
      await guest.frameLocator('#lot1-frame').locator('#step-9').click();
      await guest.locator('#step-10').click();

      await expect(chrome.locator('#log')).toContainText('dom.click', { timeout: 20_000 });
      await expect(chrome.locator('#log')).toContainText(/iframe|step-9|Iframe/i);
      await expect(chrome.locator('#log')).toContainText(/shadow|step-10|Shadow/i);

      const retract = chrome.locator('#log button.retract').first();
      if ((await retract.count()) > 0) {
        await retract.click();
        await expect(chrome.locator('#log')).toContainText('step.retracted');
      }

      if (shotDir !== undefined && shotDir.length > 0) {
        await chrome.screenshot({ path: join(shotDir, 'iframe-shadow-capture.png') });
        await guest.screenshot({ path: join(shotDir, 'fixture-after-capture.png') });
      }

      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 15_000 });

      const sessionsDir = env.SESSIONS_DIR;
      if (sessionsDir === undefined) {
        throw new Error('SESSIONS_DIR missing');
      }
      let jsonl = '';
      await expect
        .poll(async () => {
          try {
            jsonl = await latestRawJsonl(sessionsDir);
            return jsonl;
          } catch {
            jsonl = '';
            return '';
          }
        })
        .not.toBe('');
      const lines = jsonl.trim().split('\n');
      const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events.some((event) => event.kind === 'record.start')).toBe(true);
      expect(events.some((event) => event.kind === 'record.stop')).toBe(true);
      const sessions = await readdir(sessionsDir);
      const sessionId = sessions.sort().at(-1);
      if (sessionId === undefined) {
        throw new Error('No session id');
      }
      const meta = JSON.parse(
        await readFile(join(sessionsDir, sessionId, 'meta.json'), 'utf8')
      ) as { eventCount: number; sealedAt?: string };
      expect(meta.eventCount).toBeGreaterThan(0);
      expect(typeof meta.sealedAt).toBe('string');
      const capture = events.filter((event) => String(event.kind).startsWith('dom.'));
      expect(capture.length).toBeGreaterThanOrEqual(8);
      expect(
        events.some((event) => {
          const target = event.target as { framePath?: string[] } | undefined;
          return (
            Array.isArray(target?.framePath) &&
            target.framePath.some((part) => part.includes('iframe'))
          );
        })
      ).toBe(true);
      expect(
        events.some((event) => {
          const target = event.target as { shadowPath?: string[] } | undefined;
          return Array.isArray(target?.shadowPath) && target.shadowPath.length > 0;
        })
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.kind === 'dom.input' &&
            typeof event.value === 'object' &&
            event.value !== null &&
            (event.value as { masked?: boolean }).masked === true
        )
      ).toBe(true);
      expect(events.some((event) => event.kind === 'step.retracted')).toBe(true);
      const checks = events.filter((event) => event.kind === 'dom.check');
      expect(
        checks.some((event) => {
          const value = event.value as { text?: string } | undefined;
          const args = (event.action as { arguments?: string[] } | undefined)?.arguments;
          return value?.text === 'true' || args?.includes('true');
        })
      ).toBe(true);
      expect(
        checks.some((event) => {
          const value = event.value as { text?: string } | undefined;
          const args = (event.action as { arguments?: string[] } | undefined)?.arguments;
          return value?.text === 'false' || args?.includes('false');
        })
      ).toBe(true);

      if (shotDir !== undefined && shotDir.length > 0) {
        const interesting = events.filter((event) => {
          const kind = String(event.kind);
          const target = event.target as
            | { framePath?: string[]; shadowPath?: string[] }
            | undefined;
          return (
            kind === 'record.start' ||
            kind === 'record.stop' ||
            kind === 'step.retracted' ||
            kind === 'dom.check' ||
            (kind === 'dom.input' &&
              typeof event.value === 'object' &&
              event.value !== null &&
              (event.value as { masked?: boolean }).masked === true) ||
            (Array.isArray(target?.framePath) &&
              target.framePath.some((part) => part.includes('iframe'))) ||
            (Array.isArray(target?.shadowPath) && target.shadowPath.length > 0)
          );
        });
        await writeReadableExcerpt(
          join(shotDir, 'raw-jsonl-excerpt.txt'),
          interesting.map((event) => JSON.stringify(event, null, 2)).join('\n\n')
        );
      }

      await chrome.locator('#reload').click();
      await expect(guest.locator('#step-1')).toBeVisible({ timeout: 15_000 });
      await expect(guest.locator('#step-5')).not.toBeChecked();

      await chrome.locator('#replay-act').click();
      await expect(chrome.locator('#log')).toContainText(/act\(\) ok · llmCalls=0/i, {
        timeout: 90_000
      });
      await expect(chrome.locator('#log')).not.toContainText(/act\(\) failed/i);
      await expect(guest.locator('#step-5')).not.toBeChecked();

      if (shotDir !== undefined && shotDir.length > 0) {
        await chrome.screenshot({ path: join(shotDir, 'act-replay-success.png') });
      }
    } finally {
      await electronApp.close();
    }
  });
});

async function writeReadableExcerpt(path: string, body: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${body}\n`, 'utf8');
}
