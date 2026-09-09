import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { runGeneratedScript, startFixtureServer, writeGeneratedPackage } from '@spyglass/runner';

/** E43a: default away from tracked `docs/lot-6/screenshots/` (env override for capture). */
async function e2eShotDir(): Promise<string> {
  return (
    process.env.SPYGLASS_E2E_SCREENSHOT_DIR ??
    (await mkdtemp(join(tmpdir(), 'spyglass-lot6-e2e-shots-')))
  );
}

/** E43a: headed only with a display and not in CI (any non-empty CI). */
function headedSafe(): boolean {
  const ci = process.env.CI;
  if (typeof ci === 'string' && ci.length > 0) {
    return false;
  }
  const display = typeof process.env.DISPLAY === 'string' && process.env.DISPLAY.length > 0;
  return display;
}

function lot6Scenario(startUrl: string): Scenario {
  const step: RefinedStep = {
    index: 0,
    intent: 'Je clique sur Start',
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector: '[data-testid="go"]',
        selectorStrategy: 'testId'
      }
    },
    verification: {
      type: 'elementVisible',
      expected: '[data-testid="done"]',
      strength: 'strong',
      confirmedByUser: true,
      timeoutMs: 10_000
    },
    sourceEvents: ['evt_000001']
  };
  return {
    schemaVersion: 1,
    sessionId: 'ses_lot6_e2e',
    startUrl,
    generatedAt: new Date().toISOString(),
    steps: [step]
  };
}

test.describe('Lot 6 generated script outside Electron', () => {
  test('same script headed (when display) and --headless with --no-ai (no API keys)', async () => {
    test.setTimeout(120_000);
    const server = await startFixtureServer();
    const shotOverride = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
    let sessionDir: string | undefined;
    let shotDir: string | undefined;
    try {
      sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-e2e-'));
      shotDir = await e2eShotDir();
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      await mkdir(shotDir, { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SPYGLASS_NO_SANDBOX: '1',
        SPYGLASS_DISABLE_GPU: '1'
      };
      delete env.LLM_SMART_API_KEY;
      delete env.LLM_FAST_API_KEY;
      delete env.ANTHROPIC_API_KEY;

      if (headedSafe()) {
        const headedEnv = { ...env };
        delete headedEnv.CI;
        headedEnv.SPYGLASS_PROOF_SCREENSHOT = join(shotDir, 'headed-run.png');
        const headed = await runGeneratedScript(
          scenario,
          ['--no-ai', '--timeout', '15000'],
          headedEnv,
          paths.dir
        );
        expect(headed).toBe(0);
      }

      const headless = await runGeneratedScript(
        scenario,
        ['--headless', '--no-ai', '--timeout', '15000'],
        { ...env, CI: '1' },
        paths.dir
      );
      expect(headless).toBe(0);
    } finally {
      try {
        await server.close();
      } catch {
        // still remove temp dirs
      }
      if (sessionDir !== undefined) {
        await rm(sessionDir, { recursive: true, force: true });
      }
      if (shotDir !== undefined && shotOverride === undefined) {
        await rm(shotDir, { recursive: true, force: true });
      }
    }
  });
});
