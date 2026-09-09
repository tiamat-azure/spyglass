import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
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
const isWin = process.platform === 'win32';
const generatedRunTimeoutMs = isWin ? 30_000 : 12_000;
const generatedRunTestBudgetMs = isWin ? 120_000 : 60_000;

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
      timeoutMs: generatedRunTimeoutMs
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

function generatedScriptEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPYGLASS_NO_SANDBOX: '1',
    SPYGLASS_DISABLE_GPU: '1',
    ...overrides
  };
  delete env.LLM_SMART_API_KEY;
  delete env.LLM_FAST_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.SPYGLASS_PROOF_SCREENSHOT;
  return env;
}

function attachStdioCapture(): { stdout: () => string; stderr: () => string; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    out.push(text);
    return writeOut(chunk);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    err.push(text);
    return writeErr(chunk);
  }) as typeof process.stderr.write;
  return {
    stdout: () => out.join(''),
    stderr: () => err.join(''),
    restore: () => {
      process.stdout.write = writeOut;
      process.stderr.write = writeErr;
    }
  };
}

function lastExitLine(stdout: string): string {
  return stdout.trim().split('\n').at(-1) ?? '';
}

describe('Lot 6 generated script outside Electron (CA-10 / CA-11)', () => {
  it('runs --headless --no-ai without API keys on a local fixture', async () => {
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-headless-'));
    const capture = attachStdioCapture();
    try {
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      const env = generatedScriptEnv({ CI: '1' });
      const argv = ['--headless', '--no-ai', '--timeout', String(generatedRunTimeoutMs)];
      let code = await runGeneratedScript(scenario, argv, env, paths.dir);
      if (code !== 0) {
        code = await runGeneratedScript(scenario, argv, env, paths.dir);
      }
      const stdout = capture.stdout();
      const stderr = capture.stderr();
      const exitLine = lastExitLine(stdout);
      expect(
        code,
        `headless runGeneratedScript exit ${String(code)} line=${exitLine} stderr=${stderr}`
      ).toBe(0);
    } finally {
      capture.restore();
      await server.close();
    }
  }, generatedRunTestBudgetMs);

  it('runs headed (visible) --no-ai when a display is available', async () => {
    if (!headedAvailable()) {
      return;
    }
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-headed-'));
    try {
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      const env = generatedScriptEnv();
      delete env.CI;
      if (process.env.SPYGLASS_LOT6_HEADED_SHOT !== undefined) {
        env.SPYGLASS_PROOF_SCREENSHOT = process.env.SPYGLASS_LOT6_HEADED_SHOT;
      }
      const code = await runGeneratedScript(
        scenario,
        ['--no-ai', '--timeout', String(generatedRunTimeoutMs)],
        env,
        paths.dir
      );
      expect(code).toBe(0);
    } finally {
      await server.close();
    }
  }, generatedRunTestBudgetMs);

  it('executes generated scenario.ts as a subprocess that imports runScenario', async () => {
    const server = await startFixtureServer();
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-spawn-'));
    try {
      const scenario = lot6Scenario(`${server.origin}/lot6-fixture.html`);
      const paths = await writeGeneratedPackage({ sessionDir, scenario });
      expect(await readFile(paths.scenarioTs, 'utf8')).toContain('runScenario');
      await mkdir(join(paths.dir, 'node_modules', '@spyglass'), { recursive: true });
      await symlink(
        join(repoRoot(), 'packages/runner'),
        join(paths.dir, 'node_modules', '@spyglass', 'runner')
      );
      const env = generatedScriptEnv({ CI: '1' });
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          '--experimental-transform-types',
          'scenario.ts',
          '--headless',
          '--no-ai',
          '--timeout',
          String(generatedRunTimeoutMs)
        ],
        { cwd: paths.dir, env, timeout: isWin ? 90_000 : 45_000 }
      );
      const line = lastExitLine(stdout);
      const parsed = JSON.parse(line) as { exitCode: number; runDir?: string };
      expect(
        parsed.exitCode,
        `spawned scenario.ts exit ${String(parsed.exitCode)} runDir=${parsed.runDir ?? ''} stderr=${stderr}`
      ).toBe(0);
    } finally {
      await server.close();
    }
  }, generatedRunTestBudgetMs);
});
