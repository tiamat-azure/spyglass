import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { repoRoot } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { writeGeneratedPackage } from './generate.ts';
import { runGeneratedScript } from './generated-run.ts';
import { startFixtureServer } from './http-fixture.ts';

const execFileAsync = promisify(execFile);

function lot6Scenario(startUrl: string): Scenario {
  const step: RefinedStep = {
    index: 0,
    intent: 'Je clique sur Start',
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector: '[data-testid="go"]',
        selectorStrategy: 'testId',
        description: 'Start'
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
    sessionId: 'ses_lot6_outside',
    startUrl,
    generatedAt: new Date().toISOString(),
    steps: [step]
  };
}

function headedAvailable(): boolean {
  return typeof process.env.DISPLAY === 'string' && process.env.DISPLAY.length > 0;
}

describe('Lot 6 generated script outside Electron (CA-10 / CA-11)', () => {
  it('runs --headless --no-ai without API keys on a local fixture', async () => {
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-headless-'));
    try {
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CI: '1',
        SPYGLASS_NO_SANDBOX: '1',
        SPYGLASS_DISABLE_GPU: '1'
      };
      delete env.LLM_SMART_API_KEY;
      delete env.LLM_FAST_API_KEY;
      delete env.ANTHROPIC_API_KEY;
      const code = await runGeneratedScript(
        scenario,
        ['--headless', '--no-ai', '--timeout', '12000'],
        env,
        paths.dir
      );
      expect(code).toBe(0);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('runs headed (visible) --no-ai when a display is available', async () => {
    if (!headedAvailable()) {
      return;
    }
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-headed-'));
    try {
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SPYGLASS_NO_SANDBOX: '1',
        SPYGLASS_DISABLE_GPU: '1'
      };
      delete env.CI;
      delete env.LLM_SMART_API_KEY;
      delete env.ANTHROPIC_API_KEY;
      if (process.env.SPYGLASS_LOT6_HEADED_SHOT !== undefined) {
        env.SPYGLASS_PROOF_SCREENSHOT = process.env.SPYGLASS_LOT6_HEADED_SHOT;
      }
      const code = await runGeneratedScript(
        scenario,
        ['--no-ai', '--timeout', '12000'],
        env,
        paths.dir
      );
      expect(code).toBe(0);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('executes generated scenario.ts as a subprocess (declared @spyglass/runner)', async () => {
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-spawn-'));
    try {
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      await mkdir(join(paths.dir, 'node_modules', '@spyglass'), { recursive: true });
      await symlink(
        join(repoRoot(), 'packages/runner'),
        join(paths.dir, 'node_modules', '@spyglass', 'runner')
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CI: '1',
        SPYGLASS_NO_SANDBOX: '1',
        SPYGLASS_DISABLE_GPU: '1'
      };
      delete env.LLM_SMART_API_KEY;
      delete env.ANTHROPIC_API_KEY;
      const { stdout } = await execFileAsync(
        process.execPath,
        ['scenario.ts', '--headless', '--no-ai', '--timeout', '12000'],
        { cwd: paths.dir, env, timeout: 45_000 }
      );
      const line = stdout.trim().split('\n').at(-1) ?? '';
      const parsed = JSON.parse(line) as { exitCode: number };
      expect(parsed.exitCode).toBe(0);
    } finally {
      await server.close();
    }
  }, 60_000);
});
