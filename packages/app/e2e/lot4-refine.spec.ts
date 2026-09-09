import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type Page, test } from '@playwright/test';
import { closeElectron } from './close-electron.ts';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;
const shotDir =
  process.env.SPYGLASS_E2E_SCREENSHOT_DIR ?? join(appDir, '../../docs/lot-4/screenshots');

async function launchEnv(overrides: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-lot4-'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  env.SPYGLASS_DISABLE_GPU = '1';
  env.SPYGLASS_NO_SANDBOX = '1';
  env.SPYGLASS_CDP = '1';
  env.SPYGLASS_USER_DATA = userData;
  env.SPYGLASS_CDP_INFO = join(userData, 'cdp.json');
  env.SESSIONS_DIR = join(userData, 'sessions');
  env.SPYGLASS_LLM_TRANSPORT = 'mock';
  env.LLM_FAST_BATCH_MS = '40';
  env.SMART_TOKEN_CONFIRM = '1';
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
    async (page) => (await page.locator('#lot1-link').count()) > 0
  );
}

test.describe('Lot 4 refine', () => {
  test('refine from fixture raw: strong/weak, routine vs doubtful, blocked finalize, sourceEvents', async () => {
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
      await chrome.locator('#tab-settings').click();
      await expect(chrome.locator('#settings-panel')).toBeVisible();
      await expect(chrome.locator('#smart-model')).toHaveValue(/claude-sonnet-4-5-20250929/);
      await chrome.locator('#tab-browser').click();
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Stop/i, { timeout: 15_000 });
      await guest.locator('#lot1-link').click();
      await expect(guest.locator('#step-1')).toBeVisible({ timeout: 15_000 });
      await guest.locator('#step-1').click();
      await guest.locator('#step-2').fill('Ada');
      await guest.locator('#step-2').blur();
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 20_000 });
      await expect(chrome.locator('#refine-panel')).toBeVisible({ timeout: 15_000 });
      await expect(chrome.locator('#refine-estimate')).toContainText(/Estimation smart/i);
      await expect(chrome.locator('#refine-confirm-row')).toBeVisible();
      await chrome.locator('#refine-panel').scrollIntoViewIfNeeded();
      await chrome
        .locator('#refine-panel')
        .screenshot({ path: join(shotDir, 'refine-ui-estimate.png') });
      await chrome.locator('#refine-confirm').check();
      await chrome.locator('#refine-run').click();
      const steps = chrome.locator('#refine-steps li.refine-step');
      await expect(steps.first()).toBeVisible({ timeout: 20_000 });
      await expect(chrome.locator('#refine-panel')).toHaveAttribute('data-revision', '1');
      await expect(chrome.locator('#refine-panel')).toHaveAttribute('data-source', 'smart');
      await expect(chrome.locator('#refine-source')).toContainText(/Profil smart/i);
      await expect(chrome.locator('.strength-badge').first()).toBeVisible();
      await chrome.locator('#refine-steps').scrollIntoViewIfNeeded();
      await chrome
        .locator('#refine-steps')
        .screenshot({ path: join(shotDir, 'strong-weak-badges.png') });
      await expect(chrome.locator('#refine-weaks')).toBeVisible();
      await expect(chrome.locator('#refine-weak-list li').first()).toBeVisible();
      await expect(chrome.locator('#refine-block')).toBeVisible();
      await expect(chrome.locator('#refine-finalize')).toBeDisabled();
      await chrome
        .locator('#refine-panel')
        .screenshot({ path: join(shotDir, 'blocked-finalize.png') });
      await expect(chrome.locator('#refine-steps .source-ids').first()).toContainText(/evt_/);
      await chrome
        .locator('#refine-steps .source-ids')
        .first()
        .screenshot({
          path: join(shotDir, 'raw-id-traceability.png')
        });
      await chrome.locator('#refine-weaks').scrollIntoViewIfNeeded();
      await chrome.locator('#refine-weaks').screenshot({
        path: join(shotDir, 'weak-confirm-routine-doubtful.png')
      });
      await chrome.locator('#refine-aggressiveness').selectOption('aggressive');
      await expect(chrome.locator('#refine-confirm-row')).toBeVisible();
      await chrome.locator('#refine-confirm').check();
      await chrome.locator('#refine-run').click();
      await expect(chrome.locator('#refine-panel')).toHaveAttribute('data-revision', '2', {
        timeout: 20_000
      });
      const routineBtn = chrome.locator('#refine-confirm-routine');
      if (await routineBtn.isEnabled()) {
        await routineBtn.click();
      }
      const doubtful = chrome.locator(
        '#refine-weak-list li[data-weak-group="doubtful"][data-confirmed="false"] button'
      );
      const count = await doubtful.count();
      for (let index = 0; index < count; index += 1) {
        await chrome
          .locator(
            '#refine-weak-list li[data-weak-group="doubtful"][data-confirmed="false"] button'
          )
          .first()
          .click();
      }
      await expect(chrome.locator('#refine-finalize')).toBeEnabled({ timeout: 10_000 });
      await chrome.locator('#refine-finalize').click();
      await expect(chrome.locator('#refine-status')).toContainText(/finalisé/i, {
        timeout: 10_000
      });

      const sessionsDir = env.SESSIONS_DIR;
      if (sessionsDir === undefined) {
        throw new Error('SESSIONS_DIR missing');
      }
      const sessions = await readdir(sessionsDir);
      const sessionId = sessions.sort().at(-1);
      if (sessionId === undefined) {
        throw new Error('No session');
      }
      const raw = await readFile(join(sessionsDir, sessionId, 'raw.jsonl'), 'utf8');
      expect(raw).toContain('record.start');
      expect(raw).toContain('record.stop');
      const rev1 = JSON.parse(
        await readFile(join(sessionsDir, sessionId, 'refined', 'rev-1.json'), 'utf8')
      ) as { status: string; aggressiveness: string };
      const rev2 = JSON.parse(
        await readFile(join(sessionsDir, sessionId, 'refined', 'rev-2.json'), 'utf8')
      ) as { status: string; aggressiveness: string; steps: Array<{ sourceEvents: string[] }> };
      expect(rev1.status).toBe('reviewing');
      expect(rev1.aggressiveness).toBe('balanced');
      expect(rev2.status).toBe('finalized');
      expect(rev2.aggressiveness).toBe('aggressive');
      expect(rev2.steps[0]?.sourceEvents[0]).toMatch(/^evt_/);
    } finally {
      await closeElectron(electronApp);
    }
  });

  test('offline smart transport cannot enter refining', async () => {
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
      await guest.locator('#lot1-link').click();
      await expect(guest.locator('#step-1')).toBeVisible({ timeout: 15_000 });
      await guest.locator('#step-1').click();
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 20_000 });
      await expect(chrome.locator('#refine-panel')).toBeVisible({ timeout: 15_000 });
      await chrome.locator('#refine-run').click();
      await expect(chrome.locator('#refine-status')).toContainText(
        /unreachable|indisponible|offline|smart/i,
        {
          timeout: 10_000
        }
      );
    } finally {
      await closeElectron(electronApp);
    }
  });
});
