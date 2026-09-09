import { mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { writeGeneratedPackage } from './generate.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import {
  applyDataset,
  exampleDataset,
  extractScenarioParameters,
  parseDataset,
  writeGeneratedDatasets
} from './parameters.ts';
import type { Recoverer } from './recover.ts';
import { runScenario } from './run.ts';
import {
  exportSessionFolder,
  importSessionFolder,
  SESSION_BUNDLE_MANIFEST
} from './session-bundle.ts';

const tmpDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tmpDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

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
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments).toBeUndefined();
    expect(extracted.scenario.steps[1]?.action.descriptor.arguments).toBeUndefined();
  });

  it('preserves duplicate explicit parameterRef as a shared variable (R4a)', () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep(0, '#pw1', 's3cret', 'password'), fillStep(1, '#pw2', 's3cret', 'password')]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.scenario.steps[0]?.action.parameterRef).toBe('password');
    expect(extracted.scenario.steps[1]?.action.parameterRef).toBe('password');
    expect(extracted.scenario.steps[1]?.action.parameterRef).not.toBe('password_2');
    expect(extracted.dataset.values.password).toBe('s3cret');
  });

  it('last-write-wins when shared explicit parameterRef values differ (R10a)', () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep(0, '#pw1', 'first', 'password'), fillStep(1, '#pw2', 'second', 'password')]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.scenario.steps[0]?.action.parameterRef).toBe('password');
    expect(extracted.scenario.steps[1]?.action.parameterRef).toBe('password');
    expect(extracted.dataset.values.password).toBe('second');
  });

  it('still uniquifies generated selector-derived names (R4a)', () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/form',
      steps: [fillStep(0, '#email', 'a@x.test'), fillStep(1, '#email', 'b@x.test')]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.scenario.steps[0]?.action.parameterRef).toBe('email');
    expect(extracted.scenario.steps[1]?.action.parameterRef).toBe('email_2');
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
    const dir = await tempDir('spyglass-lot7-ds-');
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
    const dir = await tempDir('spyglass-lot7-gends-');
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
    const sessionDir = await tempDir('spyglass-lot7-genpkg-');
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

  it('fails fast when a dataset omits a required parameterRef (P2a)', () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    expect(extracted.scenario.steps[1]?.action.descriptor.arguments).toBeUndefined();
    expect(() =>
      applyDataset(extracted.scenario, {
        schemaVersion: 1,
        name: 'incomplete',
        values: { user: 'bob' },
        secrets: ['password']
      })
    ).toThrow(/dataset is missing parameterRef: password/);
    expect(extracted.scenario.steps[1]?.action.descriptor.arguments).toBeUndefined();
  });

  it('applies an empty-string value that is present in the dataset (P2a)', () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    const applied = applyDataset(extracted.scenario, {
      schemaVersion: 1,
      name: 'example',
      values: { user: 'alice', password: '' },
      secrets: ['password']
    });
    expect(applied.steps[1]?.action.descriptor.arguments?.[0]).toBe('');
  });

  it('strips descriptor.arguments when assigning parameterRef (L7-070)', () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    expect(extracted.dataset.values.password).toBe('s3cret');
    for (const step of extracted.scenario.steps) {
      expect(step.action.descriptor.arguments).toBeUndefined();
    }
  });

  it('blanks otp/pin/cvv/apikey/ssn in the example dataset (L7-071)', () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/pay',
      steps: [
        fillStep(0, '#otp', '111111'),
        fillStep(1, '#pin', '4321'),
        fillStep(2, '#cvv', '123'),
        fillStep(3, '#apikey', 'live-key'),
        fillStep(4, '#ssn', '123-45-6789')
      ]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.dataset.secrets).toEqual(['otp', 'pin', 'cvv', 'apikey', 'ssn']);
    const example = exampleDataset(extracted.dataset);
    expect(example.values.otp).toBe('');
    expect(example.values.pin).toBe('');
    expect(example.values.cvv).toBe('');
    expect(example.values.apikey).toBe('');
    expect(example.values.ssn).toBe('');
  });

  it('resolves a relative dataset path from scriptDir (L7-014)', async () => {
    const dir = await tempDir('spyglass-lot7-scriptdir-');
    const extracted = extractScenarioParameters(loginScenario('alice', 'one'));
    await writeFile(
      join(dir, 'bob.json'),
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
      datasetPath: 'bob.json',
      scriptDir: dir
    });
    expect(result.exitCode).toBe(0);
    expect(driver.fills.map((row) => row.value)).toEqual(['bob', 'two']);
  });

  it('redacts parameter values from recovery snapshot text (L7-079)', async () => {
    const secret = 's3cret-password';
    const step = fillStep(0, '#password', secret, 'password');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: Array<{ text: string; values: Record<string, string> }> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        if (context.afterDom !== undefined) {
          captured.push({ text: context.afterDom.text, values: { ...context.afterDom.values } });
        }
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      text: `visible ${secret} on page`,
      elements: [
        { selector: '#password', visible: true, value: '', text: secret },
        { selector: '#gone', visible: false }
      ]
    });
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_params',
        startUrl: 'https://exemple.test/login',
        steps: [step]
      },
      {
        driver,
        aiRecovery: true,
        maxAiRetries: 1,
        env: {},
        recoverer
      }
    );
    expect(result.exitCode).toBe(1);
    expect(captured.length).toBeGreaterThan(0);
    for (const snap of captured) {
      expect(snap.values['#password']).toBe('');
      expect(snap.text).not.toContain(secret);
    }
  });

  it('returns a failed ExecutionReport when the dataset file is missing (L7-080)', async () => {
    const dir = await tempDir('spyglass-lot7-ds-miss-');
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
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
      datasetPath: join(dir, 'missing.json')
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.steps).toEqual([]);
    expect(result.report.warnings.join('\n')).toMatch(/dataset:/);
    expect(driver.fills).toEqual([]);
  });

  it('returns a failed ExecutionReport when the dataset JSON is malformed (L7-080)', async () => {
    const dir = await tempDir('spyglass-lot7-ds-bad-');
    await writeFile(join(dir, 'bad.json'), '{not json\n', 'utf8');
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
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
      datasetPath: join(dir, 'bad.json')
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.exitCode).toBe(1);
    expect(result.report.warnings.join('\n')).toMatch(/dataset:/);
    expect(driver.fills).toEqual([]);
  });
});

describe('Lot 7 F-47 session export/import', () => {
  it('round-trips an autonomous session folder', async () => {
    const root = await tempDir('spyglass-lot7-sess-');
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
    const root = await tempDir('spyglass-lot7-badid-');
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
    const root = await tempDir('spyglass-lot7-dotid-');
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

  it('refuses import when dest is the source session (L7-013)', async () => {
    const root = await tempDir('spyglass-lot7-overlap-');
    const sessionDir = join(root, 'ses_overlap');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_overlap', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const keep = join(sessionDir, 'keep.txt');
    await writeFile(keep, 'alive\n', 'utf8');
    await expect(importSessionFolder(sessionDir, root)).rejects.toThrow(
      /must not be the source session/
    );
    expect(await readFile(keep, 'utf8')).toBe('alive\n');
  });

  it('refuses export when dest is inside the source session (L7-020)', async () => {
    const root = await tempDir('spyglass-lot7-export-in-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const keep = join(sessionDir, 'keep.txt');
    await writeFile(keep, 'alive\n', 'utf8');
    await expect(exportSessionFolder(sessionDir, join(sessionDir, 'nested'))).rejects.toThrow(
      /must not overlap/
    );
    expect(await readFile(keep, 'utf8')).toBe('alive\n');
  });

  it('replaces an existing dest when overwrite is set so stale files are not kept (L7-020)', async () => {
    const root = await tempDir('spyglass-lot7-reexport-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    await writeFile(join(dest, 'stale.txt'), 'old\n', 'utf8');
    await exportSessionFolder(sessionDir, dest, { overwrite: true });
    await expect(readFile(join(dest, 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(dest, 'raw.jsonl'), 'utf8')).toBe('{"schemaVersion":1}\n');
    await expect(readFile(join(root, 'bundle.spyglass-prev', 'stale.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('refuses export to a non-empty destination without overwrite (O7a)', async () => {
    const root = await tempDir('spyglass-lot7-export-busy-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    await writeFile(join(dest, 'keep.txt'), 'alive\n', 'utf8');
    await expect(exportSessionFolder(sessionDir, dest)).rejects.toThrow(/destination is not empty/);
    expect(await readFile(join(dest, 'keep.txt'), 'utf8')).toBe('alive\n');
  });

  it('refuses import when a session with the same id already exists (I7a)', async () => {
    const root = await tempDir('spyglass-lot7-import-exists-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    const sessionsRoot = join(root, 'imported');
    const existing = join(sessionsRoot, 'ses_export');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'stale.txt'), 'old\n', 'utf8');
    await expect(importSessionFolder(dest, sessionsRoot)).rejects.toThrow(/session already exists/);
    expect(await readFile(join(existing, 'stale.txt'), 'utf8')).toBe('old\n');
  });

  it('refuses import when the bundle contains a symlink (L7-039)', async () => {
    const root = await tempDir('spyglass-lot7-symlink-import-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    await symlink(join(root, 'outside'), join(dest, 'escape'));
    await expect(importSessionFolder(dest, join(root, 'imported'))).rejects.toThrow(/symlink/);
  });

  it('refuses a symlink meta.json before reading it (L7-064)', async () => {
    const root = await tempDir('spyglass-lot7-meta-symlink-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    const leaked = join(root, 'secret.json');
    await writeFile(leaked, '{"sessionId":"leaked"}\n', 'utf8');
    await rm(join(dest, 'meta.json'));
    await symlink(leaked, join(dest, 'meta.json'));
    await expect(importSessionFolder(dest, join(root, 'imported'))).rejects.toThrow(/symlink/);
  });

  it('recovers an orphaned backup then refuses to overwrite it (L7-040 / L7-063)', async () => {
    const root = await tempDir('spyglass-lot7-orphan-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    const orphan = `${dest}.spyglass-prev-deadbeef`;
    await rename(dest, orphan);
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1,"fresh":true}\n', 'utf8');
    await expect(exportSessionFolder(sessionDir, dest)).rejects.toThrow(/destination is not empty/);
    expect(await readFile(join(dest, 'raw.jsonl'), 'utf8')).toBe('{"schemaVersion":1}\n');
    await expect(readFile(join(orphan, 'raw.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores the newest orphaned backup when dest is missing (L7-058)', async () => {
    const root = await tempDir('spyglass-lot7-orphan-mtime-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    const older = `${dest}.spyglass-prev-aaaa`;
    const newer = `${dest}.spyglass-prev-zzzz`;
    await rename(dest, older);
    await writeFile(join(older, 'which.txt'), 'old\n', 'utf8');
    await mkdir(newer, { recursive: true });
    await writeFile(
      join(newer, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(newer, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    await writeFile(join(newer, 'which.txt'), 'new\n', 'utf8');
    const past = new Date(Date.now() - 120_000);
    const recent = new Date();
    await utimes(older, past, past);
    await utimes(newer, recent, recent);
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1,"fresh":true}\n', 'utf8');
    await expect(exportSessionFolder(sessionDir, dest)).rejects.toThrow(/destination is not empty/);
    expect(await readFile(join(dest, 'which.txt'), 'utf8')).toBe('new\n');
    await expect(readFile(join(older, 'which.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(newer, 'which.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
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
