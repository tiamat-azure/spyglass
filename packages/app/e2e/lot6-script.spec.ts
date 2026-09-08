import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { runGeneratedScript, startFixtureServer, writeGeneratedPackage } from '@spyglass/runner';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir =
  process.env.SPYGLASS_E2E_SCREENSHOT_DIR ?? join(appDir, '../../docs/lot-6/screenshots');

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
  test('same script headed and --headless with --no-ai (no API keys)', async () => {
    test.setTimeout(120_000);
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-e2e-'));
    try {
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
      delete env.CI;

      const headedEnv = { ...env, SPYGLASS_PROOF_SCREENSHOT: join(shotDir, 'headed-run.png') };
      const headed = await runGeneratedScript(
        scenario,
        ['--no-ai', '--timeout', '15000'],
        headedEnv,
        paths.dir
      );
      expect(headed).toBe(0);

      const headless = await runGeneratedScript(
        scenario,
        ['--headless', '--no-ai', '--timeout', '15000'],
        { ...env, CI: '1' },
        paths.dir
      );
      expect(headless).toBe(0);
    } finally {
      await server.close();
    }
  });
});
