import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { writeGeneratedPackage } from './generate.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import {
  applyDataset,
  extractScenarioParameters,
  parseDataset,
  writeGeneratedDatasets
} from './parameters.ts';
import { runScenario } from './run.ts';
import {
  exportSessionFolder,
  importSessionFolder,
  SESSION_BUNDLE_MANIFEST
} from './session-bundle.ts';

function fillStep(index: number, selector: string, value: string, ref?: string): RefinedStep {
  const step: RefinedStep = {
    index,
    intent: 'Je saisis',
    action: {
      type: 'fill',
      descriptor: { type: 'fill', selector, arguments: [value] }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
  };
  if (ref !== undefined) {
    step.action.parameterRef = ref;
  }
  return step;
}

function loginScenario(user: string, password: string): Scenario {
  return {
    schemaVersion: 1,
    sessionId: 'ses_params',
    startUrl: 'https://exemple.test/login',
    steps: [fillStep(0, '#user', user), fillStep(1, '#password', password)]
  };
}

describe('Lot 7 F-48 parameterization', () => {
  it('extracts fill values including secrets as script variables', () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    expect(extracted.scenario.steps[0]?.action.parameterRef).toBe('user');
    expect(extracted.scenario.steps[1]?.action.parameterRef).toBe('password');
    expect(extracted.dataset.values.user).toBe('alice');
    expect(extracted.dataset.values.password).toBe('s3cret');
    expect(extracted.dataset.secrets).toContain('password');
  });

  it('replays the same scenario with distinct datasets', async () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 'one'));
    const datasetA = {
      schemaVersion: 1 as const,
      name: 'a',
      values: { user: 'alice', password: 'one' },
      secrets: ['password']
    };
    const datasetB = {
      schemaVersion: 1 as const,
      name: 'b',
      values: { user: 'bob', password: 'two' },
      secrets: ['password']
    };
    const driverA = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#user', visible: true, value: '' },
        { selector: '#password', visible: true, value: '' }
      ]
    });
    const driverB = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#user', visible: true, value: '' },
        { selector: '#password', visible: true, value: '' }
      ]
    });
    const scenarioA = applyDataset(extracted.scenario, datasetA);
    const scenarioB = applyDataset(extracted.scenario, datasetB);
    const runA = await runScenario(scenarioA, { driver: driverA, aiRecovery: false });
    const runB = await runScenario(scenarioB, { driver: driverB, aiRecovery: false });
    expect(runA.exitCode).toBe(0);
    expect(runB.exitCode).toBe(0);
    expect(driverA.fills.map((row) => row.value)).toEqual(['alice', 'one']);
    expect(driverB.fills.map((row) => row.value)).toEqual(['bob', 'two']);
  });

  it('applies --dataset from JSON on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-ds-'));
    const extracted = extractScenarioParameters(loginScenario('alice', 'one'));
    const datasetPath = join(dir, 'bob.json');
    await writeFile(
      datasetPath,
      `${JSON.stringify({ schemaVersion: 1, name: 'bob', values: { user: 'bob', password: 'two' }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#user', visible: true, value: '' },
        { selector: '#password', visible: true, value: '' }
      ]
    });
    const result = await runScenario(extracted.scenario, {
      driver,
      aiRecovery: false,
      datasetPath
    });
    expect(result.exitCode).toBe(0);
    expect(driver.fills.map((row) => row.value)).toEqual(['bob', 'two']);
  });

  it('writes datasets next to the generated package', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-gends-'));
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    const paths = await writeGeneratedDatasets(dir, extracted.dataset);
    const recorded = parseDataset(JSON.parse(await readFile(paths.recorded, 'utf8')));
    const example = parseDataset(JSON.parse(await readFile(paths.example, 'utf8')));
    expect(recorded.values.user).toBe('alice');
    expect(example.values.user).toBe('example_user');
    expect(example.values.password).toBe('');
    expect(example.values.user).not.toBe(recorded.values.user);
  });

  it('writeGeneratedPackage emits datasets/recorded.json and example.json', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-genpkg-'));
    const paths = await writeGeneratedPackage({
      sessionDir,
      scenario: loginScenario('alice', 's3cret')
    });
    const recorded = parseDataset(
      JSON.parse(await readFile(join(paths.dir, 'datasets', 'recorded.json'), 'utf8'))
    );
    const example = parseDataset(
      JSON.parse(await readFile(join(paths.dir, 'datasets', 'example.json'), 'utf8'))
    );
    const generated = JSON.parse(await readFile(paths.scenarioJson, 'utf8')) as Scenario;
    expect(generated.steps[0]?.action.parameterRef).toBe('user');
    expect(recorded.values.user).toBe('alice');
    expect(example.values.user).toBe('example_user');
  });
});

describe('Lot 7 F-47 session export/import', () => {
  it('round-trips an autonomous session folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-lot7-sess-'));
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', startUrl: 'https://exemple.test', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1,"id":"evt_1"}\n', 'utf8');
    const dest = join(root, 'bundle');
    const exported = await exportSessionFolder(sessionDir, dest);
    expect(exported.sessionId).toBe('ses_export');
    const manifest = JSON.parse(await readFile(join(dest, SESSION_BUNDLE_MANIFEST), 'utf8')) as {
      kind: string;
    };
    expect(manifest.kind).toBe('spyglass-session');
    const sessionsRoot = join(root, 'imported');
    const imported = await importSessionFolder(dest, sessionsRoot);
    expect(imported.sessionId).toBe('ses_export');
    const meta = JSON.parse(await readFile(join(imported.sessionDir, 'meta.json'), 'utf8')) as {
      sessionId: string;
    };
    expect(meta.sessionId).toBe('ses_export');
  });

  it('refuses path-traversal session ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-lot7-badid-'));
    await writeFile(
      join(root, 'meta.json'),
      `${JSON.stringify({ sessionId: '../escape', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await expect(importSessionFolder(root, join(root, 'sessions'))).rejects.toThrow(
      /invalid sessionId/
    );
  });

  it('refuses dot-segment session ids and does not rm the sessions root (L7-007)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-lot7-dotid-'));
    const sessionsRoot = join(root, 'sessions');
    await mkdir(sessionsRoot, { recursive: true });
    const marker = join(sessionsRoot, 'keep.txt');
    await writeFile(marker, 'safe\n', 'utf8');
    await writeFile(
      join(root, 'meta.json'),
      `${JSON.stringify({ sessionId: '.', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await expect(importSessionFolder(root, sessionsRoot)).rejects.toThrow(/invalid sessionId/);
    await writeFile(
      join(root, 'meta.json'),
      `${JSON.stringify({ sessionId: '..', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await expect(importSessionFolder(root, sessionsRoot)).rejects.toThrow(/invalid sessionId/);
    expect(await readFile(marker, 'utf8')).toBe('safe\n');
  });
});

describe('Lot 7 F-59 step gate', () => {
  it('waits between steps and stops on user halt', async () => {
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#a', visible: true },
        { selector: '#b', visible: true }
      ]
    });
    const seen: number[] = [];
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_step',
        startUrl: 'https://exemple.test/start',
        steps: [
          fillStep(0, '#a', 'x'),
          {
            index: 1,
            intent: 'suite',
            action: { type: 'click', descriptor: { type: 'click', selector: '#b' } },
            verification: {
              type: 'elementVisible',
              expected: '#b',
              strength: 'strong',
              confirmedByUser: true
            },
            sourceEvents: ['evt_000002']
          }
        ]
      },
      {
        driver,
        aiRecovery: false,
        stepGate: {
          wait: async (stepIndex) => {
            seen.push(stepIndex);
            return stepIndex === 0 ? 'continue' : 'stop';
          }
        }
      }
    );
    expect(seen).toEqual([0, 1]);
    expect(result.exitCode).toBe(1);
    expect(result.report.steps[1]?.error).toMatch(/stopped by user/);
  });
});
