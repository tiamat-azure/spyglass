import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type Page, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;
const shotDir =
  process.env.SPYGLASS_E2E_SCREENSHOT_DIR ?? join(appDir, '../../docs/lot-5/screenshots');

async function launchEnv(overrides: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-lot5-'));
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
  env.SPYGLASS_MOCK_RECOVER_SELECTOR = '[data-testid="step-1"]';
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

async function confirmWeaksAndFinalize(chrome: Page): Promise<void> {
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
      .locator('#refine-weak-list li[data-weak-group="doubtful"][data-confirmed="false"] button')
      .first()
      .click();
  }
  await expect(chrome.locator('#refine-finalize')).toBeEnabled({ timeout: 10_000 });
  await chrome.locator('#refine-finalize').click();
  await expect(chrome.locator('#refine-status')).toContainText(/finalisé/i, { timeout: 10_000 });
}

async function latestSessionDir(sessionsDir: string): Promise<string> {
  const sessions = await readdir(sessionsDir);
  const sessionId = sessions.sort().at(-1);
  if (sessionId === undefined) {
    throw new Error('No session');
  }
  return join(sessionsDir, sessionId);
}

test.describe('Lot 5 runner', () => {
  test('deterministic replay, AI recovery patch unapplied, --no-ai fail-clean', async () => {
    test.setTimeout(240_000);
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
      await guest.locator('#lot1-link').click();
      await expect(guest.locator('#step-1')).toBeVisible({ timeout: 15_000 });
      await guest.locator('#step-1').click();
      await chrome.locator('#record-btn').click();
      await expect(chrome.locator('#record-btn')).toHaveText(/Record/i, { timeout: 20_000 });
      await expect(chrome.locator('#refine-panel')).toBeVisible({ timeout: 15_000 });
      if (await chrome.locator('#refine-confirm-row').isVisible()) {
        await chrome.locator('#refine-confirm').check();
      }
      await chrome.locator('#refine-run').click();
      await expect(chrome.locator('#refine-steps li.refine-step').first()).toBeVisible({
        timeout: 20_000
      });
      await confirmWeaksAndFinalize(chrome);
      await expect(chrome.locator('#replay-panel')).toBeVisible();
      await chrome.locator('#replay-panel').scrollIntoViewIfNeeded();
      await chrome.locator('#replay-panel').screenshot({
        path: join(shotDir, 'replay-panel-ready.png')
      });

      await chrome.locator('#replay-run').click();
      await expect(chrome.locator('#replay-steps li').first()).toBeVisible({ timeout: 30_000 });
      await expect(chrome.locator('#replay-steps li').last()).toContainText(/passed/i, {
        timeout: 60_000
      });
      expect(await chrome.locator('#replay-steps li[data-mode="AI"]').count()).toBe(0);
      await chrome.locator('#replay-panel').screenshot({
        path: join(shotDir, 'deterministic-replay-success.png')
      });
      const replayChat = chrome.locator('#log li.chat-msg[data-kind="replay.step"]');
      await expect(replayChat.last()).toBeVisible({ timeout: 10_000 });
      await expect(replayChat.last()).toContainText(/script · passed/i);
      await replayChat.last().screenshot({
        path: join(shotDir, 'replay-chat-follow.png')
      });

      const sessionsDir = env.SESSIONS_DIR;
      if (sessionsDir === undefined) {
        throw new Error('SESSIONS_DIR missing');
      }
      const sessionDir = await latestSessionDir(sessionsDir);
      const revPath = join(sessionDir, 'refined', 'rev-1.json');
      const revision = JSON.parse(await readFile(revPath, 'utf8')) as {
        status: string;
        steps: Array<{
          action: { descriptor: { selector: string; fallbackSelectors?: string[] } };
          verification: { timeoutMs?: number };
        }>;
      };
      expect(revision.status).toBe('finalized');
      const generatedTs = await readFile(join(sessionDir, 'generated', 'scenario.ts'), 'utf8');
      expect(generatedTs).toContain('runGeneratedScript');
      const last = revision.steps.at(-1);
      expect(last).toBeDefined();
      const originalSelector = last?.action.descriptor.selector;
      expect(originalSelector).toBeDefined();
      if (last !== undefined) {
        last.action.descriptor.selector = '#does-not-exist';
        last.action.descriptor.fallbackSelectors = [];
        last.verification.timeoutMs = 1500;
      }
      await writeFile(revPath, `${JSON.stringify(revision, null, 2)}\n`, 'utf8');
      const generatedPath = join(sessionDir, 'generated', 'scenario.json');
      const generated = JSON.parse(await readFile(generatedPath, 'utf8')) as typeof revision & {
        steps: typeof revision.steps;
      };
      const generatedLast = generated.steps.at(-1);
      if (generatedLast !== undefined) {
        generatedLast.action.descriptor.selector = '#does-not-exist';
        generatedLast.action.descriptor.fallbackSelectors = [];
        generatedLast.verification.timeoutMs = 1500;
      }
      await writeFile(generatedPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');

      await chrome.locator('#replay-ai').check();
      await chrome.locator('#replay-run').click();
      await expect(
        chrome.locator('#replay-steps li[data-mode="AI"][data-status="passed"]')
      ).toBeVisible({
        timeout: 90_000
      });
      await chrome.locator('#replay-panel').screenshot({
        path: join(shotDir, 'broken-selector-recovery.png')
      });

      const runs = await readdir(join(sessionDir, 'runs'));
      expect(runs.length).toBeGreaterThan(0);
      let foundPatch = false;
      for (const runId of runs) {
        try {
          const patch = JSON.parse(
            await readFile(join(sessionDir, 'runs', runId, 'suggested-patch.json'), 'utf8')
          ) as { applied: boolean; patches: Array<{ suggested: { selector: string } }> };
          expect(patch.applied).toBe(false);
          expect(patch.patches[0]?.suggested.selector).toBe('[data-testid="step-1"]');
          foundPatch = true;
        } catch {
          // this run may be the deterministic one
        }
      }
      expect(foundPatch).toBe(true);
      const after = JSON.parse(await readFile(revPath, 'utf8')) as {
        steps: Array<{ action: { descriptor: { selector: string } } }>;
      };
      expect(after.steps.at(-1)?.action.descriptor.selector).toBe('#does-not-exist');
      await chrome.screenshot({ path: join(shotDir, 'suggested-patch-unapplied.png') });

      await chrome.locator('#replay-ai').uncheck();
      await chrome.locator('#replay-run').click();
      await expect(chrome.locator('#replay-steps li[data-status="failed"]').last()).toContainText(
        /failed/i,
        { timeout: 60_000 }
      );
      expect(await chrome.locator('#replay-steps li[data-mode="AI"]').count()).toBe(0);
      await chrome.locator('#replay-panel').screenshot({
        path: join(shotDir, 'no-ai-fail-clean.png')
      });
    } finally {
      await electronApp.close();
    }
  });
});
