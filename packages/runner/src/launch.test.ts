import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryPageDriver } from './memory-driver.ts';
import { type ParsedRunnerArgv, SMART_MODEL_PIN } from './options.ts';
import type { Recoverer } from './recover.ts';
import { runScenario } from './run.ts';

const { closeSpy, driverFactory, gatewayFactory } = vi.hoisted(() => ({
  closeSpy: vi.fn(),
  driverFactory: vi.fn(),
  gatewayFactory: vi.fn()
}));

vi.mock('./playwright-driver.ts', () => ({
  createPlaywrightDriver: (...args: unknown[]) => driverFactory(...args)
}));

vi.mock('./cli-gateway.ts', () => ({
  createCliGateway: (...args: unknown[]) => gatewayFactory(...args)
}));

import { launchPlaywrightRun } from './launch.ts';

function clickStep(): RefinedStep {
  return {
    index: 0,
    intent: 'Je clique',
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector: '#go',
        selectorStrategy: 'css'
      }
    },
    verification: {
      type: 'elementVisible',
      expected: '#go',
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: ['evt_000001']
  };
}

function scenario(): Scenario {
  return {
    schemaVersion: 1,
    sessionId: 'ses_l6_053',
    startUrl: 'https://exemple.test/start',
    steps: [clickStep()]
  };
}

function parsed(overrides: Partial<ParsedRunnerArgv> = {}): ParsedRunnerArgv {
  return {
    headless: true,
    timeoutMs: 1000,
    maxAiRetries: 1,
    aiRecovery: true,
    trace: false,
    smartModel: SMART_MODEL_PIN,
    noAi: false,
    forceAi: true,
    help: false,
    ...overrides
  };
}

function mockDriver(): MemoryPageDriver {
  const driver = new MemoryPageDriver({
    elements: [{ selector: '#go', visible: true }]
  });
  const original = driver.close.bind(driver);
  driver.close = async () => {
    closeSpy();
    await original();
  };
  return driver;
}

describe('launchPlaywrightRun recoverer / gateway (L6-053 / L6-055)', () => {
  it('does not launch Chromium if createCliGateway throws (L6-053)', async () => {
    closeSpy.mockClear();
    driverFactory.mockReset();
    gatewayFactory.mockReset();
    gatewayFactory.mockImplementation(() => {
      throw new Error('gateway boom');
    });
    driverFactory.mockImplementation(async () => mockDriver());
    const reportDir = await mkdtemp(join(tmpdir(), 'spyglass-l6-053-'));
    await expect(
      launchPlaywrightRun({
        scenario: scenario(),
        parsed: parsed(),
        env: { CI: '1' },
        reportDir
      })
    ).rejects.toThrow(/gateway boom/);
    expect(driverFactory).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('uses a caller-supplied recoverer instead of createCliGateway (L6-055)', async () => {
    closeSpy.mockClear();
    driverFactory.mockReset();
    gatewayFactory.mockReset();
    gatewayFactory.mockImplementation(() => {
      throw new Error('should not create gateway');
    });
    driverFactory.mockImplementation(async () => mockDriver());
    const recover = vi.fn();
    const recoverer: Recoverer = { recover };
    const reportDir = await mkdtemp(join(tmpdir(), 'spyglass-l6-055-'));
    const result = await launchPlaywrightRun({
      scenario: scenario(),
      parsed: parsed(),
      env: { CI: '1' },
      reportDir,
      recoverer
    });
    expect(result.exitCode).toBe(0);
    expect(gatewayFactory).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('driver-less runScenario forwards options.recoverer (L6-055)', async () => {
    closeSpy.mockClear();
    driverFactory.mockReset();
    gatewayFactory.mockReset();
    gatewayFactory.mockImplementation(() => {
      throw new Error('should not create gateway');
    });
    driverFactory.mockImplementation(async () => mockDriver());
    const recover = vi.fn();
    const reportDir = await mkdtemp(join(tmpdir(), 'spyglass-l6-055-run-'));
    const result = await runScenario(scenario(), {
      argv: ['--ai', '--headless'],
      env: {},
      reportDir,
      recoverer: { recover },
      headless: true,
      aiRecovery: true
    });
    expect(result.exitCode).toBe(0);
    expect(gatewayFactory).not.toHaveBeenCalled();
  });

  it('propagates an explicit proof screenshot failure (L6-071)', async () => {
    closeSpy.mockClear();
    driverFactory.mockReset();
    gatewayFactory.mockReset();
    const driver = mockDriver();
    driver.screenshot = async () => {
      throw new Error('proof shot failed');
    };
    driverFactory.mockImplementation(async () => driver);
    const reportDir = await mkdtemp(join(tmpdir(), 'spyglass-l6-071-'));
    await expect(
      launchPlaywrightRun({
        scenario: scenario(),
        parsed: parsed({ aiRecovery: false }),
        env: { CI: '1' },
        reportDir,
        proofScreenshot: join(reportDir, 'proof.jpg')
      })
    ).rejects.toThrow(/proof shot failed/);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('driver-less runScenario keeps parseGeneratedArgv headless unless options override (L6-072)', async () => {
    const src = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'run.ts'), 'utf8');
    expect(src).not.toContain("parsed.headless = options.headless ?? argv.includes('--headless')");
    expect(src).toContain('if (options.headless !== undefined)');

    closeSpy.mockClear();
    driverFactory.mockReset();
    gatewayFactory.mockReset();
    driverFactory.mockImplementation(async () => mockDriver());
    const reportDir = await mkdtemp(join(tmpdir(), 'spyglass-l6-072-'));
    const withFlag = await runScenario(scenario(), {
      argv: ['--headless', '--no-ai'],
      env: { CI: '1' },
      reportDir
    });
    expect(withFlag.exitCode).toBe(0);
    expect(driverFactory.mock.calls[0]?.[0]).toMatchObject({ headless: true });

    driverFactory.mockReset();
    driverFactory.mockImplementation(async () => mockDriver());
    const headedDefault = await runScenario(scenario(), {
      argv: ['--no-ai'],
      env: { CI: '1' },
      reportDir
    });
    expect(headedDefault.exitCode).toBe(0);
    expect(driverFactory.mock.calls[0]?.[0]).toMatchObject({ headless: false });

    driverFactory.mockReset();
    driverFactory.mockImplementation(async () => mockDriver());
    const override = await runScenario(scenario(), {
      argv: ['--no-ai'],
      env: { CI: '1' },
      reportDir,
      headless: true
    });
    expect(override.exitCode).toBe(0);
    expect(driverFactory.mock.calls[0]?.[0]).toMatchObject({ headless: true });
  });

  it('driver-less runScenario forwards options.onProgress (L6-073)', async () => {
    const launchSrc = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), 'launch.ts'),
      'utf8'
    );
    const runSrc = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'run.ts'), 'utf8');
    expect(launchSrc).toContain('onProgress?: (event: ReplayProgress) => void');
    expect(runSrc).toContain(
      '...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {})'
    );

    closeSpy.mockClear();
    driverFactory.mockReset();
    gatewayFactory.mockReset();
    driverFactory.mockImplementation(async () => mockDriver());
    const progress: string[] = [];
    const reportDir = await mkdtemp(join(tmpdir(), 'spyglass-l6-073-'));
    const result = await runScenario(scenario(), {
      argv: ['--headless', '--no-ai'],
      env: {},
      reportDir,
      onProgress: (event) => {
        progress.push(event.message);
      }
    });
    expect(result.exitCode).toBe(0);
    expect(progress.length).toBeGreaterThan(0);
  });
});
