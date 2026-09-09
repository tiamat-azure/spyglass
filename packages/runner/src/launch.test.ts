import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
