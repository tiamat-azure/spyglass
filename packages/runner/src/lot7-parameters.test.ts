import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { repoRoot, validateScenario } from '@spyglass/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { writeGeneratedPackage } from './generate.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import {
  applyDataset,
  assertParameterRefsResolved,
  exampleDataset,
  extractScenarioParameters,
  isSecretParameterName,
  isSecretSelector,
  parseDataset,
  unappliedArguments,
  writeGeneratedDatasets
} from './parameters.ts';
import type { Recoverer } from './recover.ts';
import { runScenario } from './run.ts';
import { asScenario } from './scenario.ts';
import {
  exportSessionFolder,
  importSessionFolder,
  isSessionBundleError,
  SESSION_BUNDLE_MANIFEST,
  SessionBundleError
} from './session-bundle.ts';

const tmpDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** L7-251: fail loud if a source marker is missing (no silent slice(-1)). */
function sourceBetween(src: string, startMarker: string, endMarker?: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThan(-1);
  if (endMarker === undefined) {
    return src.slice(start);
  }
  const end = src.indexOf(endMarker, start + 1);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
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

function selectStep(index: number, selector: string, value: string, ref?: string): RefinedStep {
  const step = fillStep(index, selector, value, ref);
  step.intent = 'Je sélectionne';
  step.action.type = 'select';
  step.action.descriptor = { ...step.action.descriptor, type: 'select' };
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

  it('rejects a missing or invalid secrets field (L7-095)', () => {
    const base = { schemaVersion: 1, name: 'live', values: { user: 'a' } };
    expect(() => parseDataset(base)).toThrow(/secrets must be an array of strings/);
    expect(() => parseDataset({ ...base, secrets: 'password' })).toThrow(
      /secrets must be an array of strings/
    );
    expect(() => parseDataset({ ...base, secrets: [1, 'password'] })).toThrow(
      /secrets must be an array of strings/
    );
    expect(parseDataset({ ...base, secrets: ['password'] }).secrets).toEqual(['password']);
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
    expect(extracted.dataset.secrets).toEqual(['password']);
  });

  it('records and applies a __proto__ parameterRef as an own value (L7-102)', () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep(0, '#odd', 'captured', '__proto__')]
    };
    const extracted = extractScenarioParameters(scn);
    expect(Object.getPrototypeOf(extracted.dataset.values)).toBeNull();
    expect(Object.hasOwn(extracted.dataset.values, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(extracted.dataset.values, '__proto__')?.value).toBe(
      'captured'
    );
    const example = exampleDataset(extracted.dataset);
    expect(Object.hasOwn(example.values, '__proto__')).toBe(true);
    const parsed = parseDataset(
      JSON.parse(
        JSON.stringify({
          schemaVersion: 1,
          name: 'live',
          values: extracted.dataset.values,
          secrets: []
        })
      )
    );
    expect(Object.getPrototypeOf(parsed.values)).toBeNull();
    expect(Object.hasOwn(parsed.values, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(parsed.values, '__proto__')?.value).toBe('captured');
    const applied = applyDataset(extracted.scenario, parsed);
    expect(applied.steps[0]?.action.descriptor.arguments).toEqual(['captured']);
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

  it('does not unique-ify explicit parameterRef against a selector-derived name (D29a)', async () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/form',
      steps: [
        fillStep(0, '#email', 'first@example.com'),
        fillStep(1, '#other', 'second@example.com', 'email')
      ]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.scenario.steps[0]?.action.parameterRef).toBe('email');
    expect(extracted.scenario.steps[1]?.action.parameterRef).toBe('email');
    expect(extracted.scenario.steps[1]?.action.parameterRef).not.toBe('email_2');
    expect(extracted.dataset.values.email).toBe('second@example.com');
    expect(Object.hasOwn(extracted.dataset.values, 'email_2')).toBe(false);
    const src = await readFile(new URL('./parameters.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(
      src,
      'export function parameterNameFromStep',
      'export function isParameterizedType'
    );
    const explicitCut = fn.indexOf('if (!isParameterizedType');
    expect(explicitCut).toBeGreaterThan(-1);
    const explicitBranch = fn.slice(0, explicitCut);
    expect(explicitBranch).toContain('return step.action.parameterRef.trim()');
    expect(explicitBranch).not.toContain('uniqueName');
    expect(fn).toContain('return uniqueName(fromSelector, used)');
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
    if (process.platform !== 'win32') {
      const dirMode = (await stat(join(dir, 'datasets'))).mode & 0o777;
      const recordedMode = (await stat(paths.recorded)).mode & 0o777;
      expect(dirMode).toBe(0o700);
      expect(recordedMode).toBe(0o600);
    }
  });

  it('tightens existing dataset modes after rewrite (L7-152)', async () => {
    const dir = await tempDir('spyglass-lot7-l7152-');
    const datasets = join(dir, 'datasets');
    await mkdir(datasets, { recursive: true, mode: 0o755 });
    await writeFile(join(datasets, 'recorded.json'), '{}\n', { encoding: 'utf8', mode: 0o644 });
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    const paths = await writeGeneratedDatasets(dir, extracted.dataset);
    if (process.platform !== 'win32') {
      const dirMode = (await stat(join(dir, 'datasets'))).mode & 0o777;
      const recordedMode = (await stat(paths.recorded)).mode & 0o777;
      expect(dirMode).toBe(0o700);
      expect(recordedMode).toBe(0o600);
    }
  });

  it('writes recorded.json via chmod 0o600 temp then rename (L7-226)', async () => {
    const src = await readFile(new URL('./parameters.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(
      src,
      'export async function writeGeneratedDatasets',
      'function nameFromSelector'
    );
    expect(fn).toContain('await chmod(tmp, 0o600)');
    expect(fn).toContain('await rename(tmp, recordedPath)');
    expect(fn.indexOf('await chmod(tmp, 0o600)')).toBeLessThan(
      fn.indexOf('await rename(tmp, recordedPath)')
    );
    expect(fn).not.toMatch(/writeFile\(\s*recordedPath/);
    expect(fn).toContain('destRemoved');
    expect(fn).toContain('await rename(tmp, recordedPath).catch(() => undefined)');
    expect(fn.indexOf('destRemoved = true')).toBeLessThan(fn.indexOf('} catch (error)'));
    expect(fn.indexOf('if (destRemoved)')).toBeGreaterThan(fn.indexOf('} catch (error)'));
    const dir = await tempDir('spyglass-lot7-l7226-');
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    const paths = await writeGeneratedDatasets(dir, extracted.dataset);
    const recorded = parseDataset(JSON.parse(await readFile(paths.recorded, 'utf8')));
    expect(recorded.values.password).toBe('s3cret');
    if (process.platform !== 'win32') {
      expect((await stat(paths.recorded)).mode & 0o777).toBe(0o600);
    }
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

  it('gitignores generated/datasets/recorded.json as local-only secrets (D11a)', async () => {
    const gitignore = await readFile(join(repoRoot(), '.gitignore'), 'utf8');
    expect(gitignore).toContain('**/generated/datasets/recorded.json');
    expect(gitignore).not.toContain('datasets/example.json');
    const sessionDir = await tempDir('spyglass-lot7-d11a-');
    const paths = await writeGeneratedPackage({
      sessionDir,
      scenario: loginScenario('alice', 's3cret')
    });
    const generatedIgnore = await readFile(join(paths.dir, '.gitignore'), 'utf8');
    expect(generatedIgnore).toContain('datasets/recorded.json');
    expect(generatedIgnore).not.toContain('example.json');
    const readme = await readFile(paths.readme, 'utf8');
    expect(readme).toMatch(/Ne commitez pas `datasets\/recorded\.json`/);
    expect(readme).toMatch(/valeurs capturées en clair/);
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

  it('fails fast when parameterRef has no dataset and no resolved args (D20a)', () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments).toBeUndefined();
    expect(() => assertParameterRefsResolved(extracted.scenario)).toThrow(
      /dataset is missing parameterRef: user, password/
    );
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

  it('preserves trailing fill arguments through extract, JSON, and apply (A27b)', () => {
    const step = fillStep(0, '#user', 'alice');
    step.action.descriptor.arguments = ['alice', 'slowly', 'ltr'];
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/login',
      steps: [step]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.dataset.values.user).toBe('alice');
    expect(extracted.scenario.steps[0]?.action.parameterRef).toBe('user');
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments?.[0]).toBeNull();
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments?.slice(1)).toEqual([
      'slowly',
      'ltr'
    ]);
    expect(() => assertParameterRefsResolved(extracted.scenario)).toThrow(
      /dataset is missing parameterRef: user/
    );
    const parsed = JSON.parse(JSON.stringify(extracted.scenario)) as unknown;
    expect(validateScenario(parsed).valid).toBe(true);
    const loaded = asScenario(parsed);
    expect(loaded.steps[0]?.action.descriptor.arguments?.[0]).toBeNull();
    expect(() => assertParameterRefsResolved(loaded)).toThrow(
      /dataset is missing parameterRef: user/
    );
    expect(() =>
      applyDataset(loaded, { schemaVersion: 1, name: 'incomplete', values: {}, secrets: [] })
    ).toThrow(/dataset is missing parameterRef: user/);
    const applied = applyDataset(loaded, {
      schemaVersion: 1,
      name: 'live',
      values: { user: 'bob' },
      secrets: []
    });
    expect(applied.steps[0]?.action.descriptor.arguments).toEqual(['bob', 'slowly', 'ltr']);
    const again = applyDataset(applied, {
      schemaVersion: 1,
      name: 'live',
      values: { user: 'carol' },
      secrets: []
    });
    expect(again.steps[0]?.action.descriptor.arguments).toEqual(['carol', 'slowly', 'ltr']);
  });

  it('keeps vacant [0] as JSON null so trailing indices stay (N29a)', async () => {
    expect(unappliedArguments(['slowly', 'ltr'])).toEqual([null, 'slowly', 'ltr']);
    expect(unappliedArguments(['slowly', 'ltr'])[0]).not.toBe('');
    expect(JSON.stringify(unappliedArguments(['slowly', 'ltr']))).toBe('[null,"slowly","ltr"]');
    const src = await readFile(new URL('./parameters.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(
      src,
      'export function unappliedArguments',
      'function isUnresolvedParameterArg'
    );
    expect(fn).toContain('null');
    expect(fn).not.toContain('undefined');
    expect(fn).not.toContain("''");
  });

  it('preserves JSON-serializable non-string trailing args (L7-224)', async () => {
    const step = fillStep(0, '#user', 'alice');
    step.action.descriptor.arguments = [
      'alice',
      0,
      false,
      2,
      true,
      { dir: 'ltr' }
    ] as unknown as string[];
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/login',
      steps: [step]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments?.slice(1)).toEqual([
      0,
      false,
      2,
      true,
      { dir: 'ltr' }
    ]);
    const applied = applyDataset(extracted.scenario, {
      schemaVersion: 1,
      name: 'live',
      values: { user: 'bob' },
      secrets: []
    });
    expect(applied.steps[0]?.action.descriptor.arguments).toEqual([
      'bob',
      0,
      false,
      2,
      true,
      { dir: 'ltr' }
    ]);
    const src = await readFile(new URL('./parameters.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(src, 'function trailingArguments', 'function cloneJsonArg');
    expect(fn).toContain('kept === undefined ? null : kept');
    expect(fn).not.toContain("typeof item === 'string'");
    expect(src).toContain('cloneJsonArg');
  });

  it('keeps vacant trailing slots when cloneJsonArg yields undefined (L7-255)', () => {
    const extracted = extractScenarioParameters(loginScenario('alice', 'two'));
    const user = extracted.scenario.steps[0];
    expect(user).toBeDefined();
    if (user !== undefined) {
      user.action.descriptor.arguments = [null, undefined, { dir: 'ltr' }] as unknown as string[];
    }
    const appliedSlots = applyDataset(extracted.scenario, {
      schemaVersion: 1,
      name: 'live',
      values: { user: 'bob', password: 'two' },
      secrets: []
    });
    expect(appliedSlots.steps[0]?.action.descriptor.arguments).toEqual([
      'bob',
      null,
      { dir: 'ltr' }
    ]);
  });

  it('preserves trailing select arguments through extract and apply (A27b)', async () => {
    const step = selectStep(0, '#country', 'fr');
    step.action.descriptor.arguments = ['fr', 'exact'];
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/form',
      steps: [step]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.dataset.values.country).toBe('fr');
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments?.[0]).toBeNull();
    expect(extracted.scenario.steps[0]?.action.descriptor.arguments?.slice(1)).toEqual(['exact']);
    expect(() => assertParameterRefsResolved(extracted.scenario)).toThrow(
      /dataset is missing parameterRef: country/
    );
    const applied = applyDataset(extracted.scenario, {
      schemaVersion: 1,
      name: 'live',
      values: { country: 'be' },
      secrets: []
    });
    expect(applied.steps[0]?.action.descriptor.arguments).toEqual(['be', 'exact']);
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/form',
      elements: [{ selector: '#country', visible: true, value: '' }]
    });
    const result = await runScenario(extracted.scenario, {
      driver,
      aiRecovery: false,
      datasetPath: undefined
    });
    expect(result.exitCode).toBe(1);
    expect(driver.fills).toEqual([]);
    const dir = await tempDir('spyglass-lot7-a27b-select-');
    await writeFile(
      join(dir, 'live.json'),
      `${JSON.stringify({ schemaVersion: 1, name: 'live', values: { country: 'be' }, secrets: [] }, null, 2)}\n`,
      'utf8'
    );
    const driver2 = new MemoryPageDriver({
      url: 'https://exemple.test/form',
      elements: [{ selector: '#country', visible: true, value: '' }]
    });
    const replay = await runScenario(extracted.scenario, {
      driver: driver2,
      aiRecovery: false,
      datasetPath: 'live.json',
      scriptDir: dir
    });
    expect(replay.exitCode).toBe(0);
    expect(driver2.fills).toEqual([{ selector: '#country', value: 'be' }]);
  });

  it('does not replace the full arguments array with only the dataset value (A27b)', async () => {
    const src = await readFile(new URL('./parameters.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/descriptor\.arguments = \[value\];/u);
    expect(src).toContain('applyParameterizedArgument(descriptor, value)');
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

  it('does not treat pin as a substring of shipping/spinner names (L36b-bound)', async () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/shop',
      steps: [
        fillStep(0, '#shipping_address', '1 Main St'),
        fillStep(1, '#spinner', 'loading'),
        fillStep(2, '#shopping', 'cart')
      ]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.dataset.secrets).toEqual([]);
    expect(extracted.dataset.values.shipping_address).toBe('1 Main St');
    expect(exampleDataset(extracted.dataset).values.shipping_address).toBe(
      'example_shipping_address'
    );
    expect(isSecretParameterName('shipping_address')).toBe(false);
    expect(isSecretParameterName('spinner')).toBe(false);
    expect(isSecretParameterName('shopping')).toBe(false);
    expect(isSecretSelector('#shipping_address')).toBe(false);
    expect(isSecretSelector('#spinner')).toBe(false);
    expect(isSecretSelector('#shopping')).toBe(false);
    const src = await readFile(new URL('./parameters.ts', import.meta.url), 'utf8');
    expect(src).toContain('L36b-bound');
    expect(src).toContain('function identifierTokens');
    expect(src).toContain('SECRET_NAME.test(token)');
  });

  it('still classifies real secret-ish names as secrets (L36b-bound)', () => {
    const scn: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_params',
      startUrl: 'https://exemple.test/pay',
      steps: [
        fillStep(0, '#password', 's3cret'),
        fillStep(1, '#user-pin', '4321'),
        fillStep(2, '#pin-code', '9999'),
        fillStep(3, '#api_key', 'live-key'),
        fillStep(4, '#csrf-token', 'tok'),
        fillStep(5, '#mot-de-passe', 'mdp1')
      ]
    };
    const extracted = extractScenarioParameters(scn);
    expect(extracted.dataset.secrets).toEqual([
      'password',
      'user_pin',
      'pin_code',
      'api_key',
      'csrf_token',
      'mot_de_passe'
    ]);
    expect(isSecretParameterName('password')).toBe(true);
    expect(isSecretParameterName('pin')).toBe(true);
    expect(isSecretParameterName('pin_code')).toBe(true);
    expect(isSecretParameterName('otp')).toBe(true);
    expect(isSecretParameterName('cvv')).toBe(true);
    expect(isSecretParameterName('ssn')).toBe(true);
    expect(isSecretParameterName('apikey')).toBe(true);
    expect(isSecretParameterName('api_key')).toBe(true);
    expect(isSecretParameterName('api-key')).toBe(true);
    expect(isSecretParameterName('pwd')).toBe(true);
    expect(isSecretParameterName('mdp')).toBe(true);
    expect(isSecretParameterName('motdepasse')).toBe(true);
    expect(isSecretParameterName('secret')).toBe(true);
    expect(isSecretParameterName('token')).toBe(true);
    expect(isSecretSelector('#pin')).toBe(true);
    expect(isSecretSelector('#password')).toBe(true);
    expect(isSecretSelector('#userPin')).toBe(true);
    expect(isSecretSelector('#pinCode')).toBe(true);
    expect(isSecretSelector('#apiKey')).toBe(true);
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

  it('resolves a relative dataset from dirname(scenarioPath) when scriptDir is absent (L7-175)', async () => {
    const dir = await tempDir('spyglass-lot7-l7175-');
    const extracted = extractScenarioParameters(loginScenario('alice', 'one'));
    await writeFile(join(dir, 'scenario.json'), `${JSON.stringify(extracted.scenario, null, 2)}\n`);
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
      scenarioPath: join(dir, 'scenario.json')
    });
    expect(result.exitCode).toBe(0);
    expect(driver.fills.map((row) => row.value)).toEqual(['bob', 'two']);
  });

  it('prefers dirname(scenarioPath) over cwd and over a conflicting scriptDir (D27a)', async () => {
    const scenarioDir = await tempDir('spyglass-lot7-d27a-scn-');
    const cwdDir = await tempDir('spyglass-lot7-d27a-cwd-');
    const otherDir = await tempDir('spyglass-lot7-d27a-other-');
    const extracted = extractScenarioParameters(loginScenario('alice', 'one'));
    await writeFile(
      join(scenarioDir, 'scenario.json'),
      `${JSON.stringify(extracted.scenario, null, 2)}\n`
    );
    await writeFile(
      join(scenarioDir, 'bob.json'),
      `${JSON.stringify({ schemaVersion: 1, name: 'bob', values: { user: 'bob', password: 'two' }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(
      join(cwdDir, 'bob.json'),
      `${JSON.stringify({ schemaVersion: 1, name: 'cwd', values: { user: 'cwd-user', password: 'cwd-pass' }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(
      join(otherDir, 'bob.json'),
      `${JSON.stringify({ schemaVersion: 1, name: 'other', values: { user: 'other-user', password: 'other-pass' }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#user', visible: true, value: '' },
        { selector: '#password', visible: true, value: '' }
      ]
    });
    const previous = process.cwd();
    try {
      process.chdir(cwdDir);
      const result = await runScenario(extracted.scenario, {
        driver,
        aiRecovery: false,
        datasetPath: 'bob.json',
        scenarioPath: join(scenarioDir, 'scenario.json'),
        scriptDir: otherDir
      });
      expect(result.exitCode).toBe(0);
      expect(driver.fills.map((row) => row.value)).toEqual(['bob', 'two']);
    } finally {
      process.chdir(previous);
    }
  });

  it('does not resolve a relative dataset from process.cwd() when scenarioPath is absent (D27a)', async () => {
    const cwdDir = await tempDir('spyglass-lot7-d27a-nocwd-');
    const extracted = extractScenarioParameters(loginScenario('alice', 'one'));
    await writeFile(
      join(cwdDir, 'bob.json'),
      `${JSON.stringify({ schemaVersion: 1, name: 'cwd', values: { user: 'cwd-user', password: 'cwd-pass' }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#user', visible: true, value: '' },
        { selector: '#password', visible: true, value: '' }
      ]
    });
    const previous = process.cwd();
    try {
      process.chdir(cwdDir);
      const result = await runScenario(extracted.scenario, {
        driver,
        aiRecovery: false,
        datasetPath: 'bob.json'
      });
      expect(result.exitCode).toBe(1);
      expect(result.report.steps).toEqual([]);
    } finally {
      process.chdir(previous);
    }
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

  it('redacts recovery snapshots with the combined before+after secret set (L7-257)', async () => {
    const beforeSecret = 'before-only-secret';
    const afterSecret = 'after-only-secret';
    const recordedArg = 'recorded-fill-arg';
    const step = fillStep(0, '#password', recordedArg, 'password');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: Array<{ before: string; after: string }> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        captured.push({
          before: context.beforeDom?.text ?? '',
          after: context.afterDom?.text ?? ''
        });
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      text: `token ${beforeSecret} ${afterSecret} in both snapshots`,
      elements: [
        { selector: '#password', visible: true, value: '' },
        { selector: '#gone', visible: false }
      ]
    });
    let snapCount = 0;
    driver.snapshot = async () => {
      snapCount += 1;
      const text = `token ${beforeSecret} ${afterSecret} in both snapshots`;
      return {
        url: driver.urlValue,
        title: driver.titleValue,
        text,
        values: {
          '#password': snapCount === 1 ? beforeSecret : afterSecret
        }
      };
    };
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
      expect(snap.before).not.toContain(beforeSecret);
      expect(snap.before).not.toContain(afterSecret);
      expect(snap.after).not.toContain(beforeSecret);
      expect(snap.after).not.toContain(afterSecret);
    }
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toContain('collectParameterSecrets(redactFrom, [input.beforeDom, afterDom])');
    const fn = sourceBetween(
      src,
      'function redactSnapshotForRecovery',
      'const PARAMETER_SECRET_MIN_LENGTH'
    );
    expect(fn).toContain('secrets: string[]');
    expect(fn).not.toContain('collectParameterSecrets(scenario, [snapshot])');
  });

  it('fails parameterized recovery when recorded step indexes are ambiguous (L7-131)', async () => {
    const live = fillStep(0, '#password', 'dataset-secret', 'password');
    live.verification.expected = '#gone';
    live.verification.timeoutMs = 40;
    const duplicate = fillStep(0, '#other', 'other-secret', 'password');
    duplicate.verification.expected = '#gone';
    duplicate.verification.timeoutMs = 40;
    const recoverer: Recoverer = {
      recover: async () => ({
        descriptor: { type: 'fill', selector: '#password', arguments: ['llm-guess'] },
        diagnosis: 'retry fill',
        confidence: 0.9
      })
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#password', visible: true, value: '' },
        { selector: '#gone', visible: false }
      ]
    });
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_params',
        startUrl: 'https://exemple.test/login',
        steps: [live, duplicate]
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
    expect(result.report.steps[0]?.error).toMatch(/ambiguous or missing recorded step/);
    expect(driver.fills.map((row) => row.value)).toEqual(['dataset-secret']);
    expect(driver.fills.map((row) => row.value)).not.toContain('llm-guess');
  });

  it('redacts remaining recorded arguments when live values are empty (L7-085)', async () => {
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
    const originalSnapshot = driver.snapshot.bind(driver);
    driver.snapshot = async () => {
      const snap = await originalSnapshot();
      return { ...snap, values: { '#password': '' } };
    };
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

  it('redacts parameterized secrets from snapshot url and title (L7-151)', async () => {
    const secret = 'tok_secret_value';
    const step = fillStep(0, '#token', secret, 'token');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: Array<{
      url: string;
      title: string;
      text: string;
      values: Record<string, string>;
    }> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        if (context.afterDom !== undefined) {
          captured.push({
            url: context.afterDom.url,
            title: context.afterDom.title,
            text: context.afterDom.text,
            values: { ...context.afterDom.values }
          });
        }
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: `https://exemple.test/login?token=${secret}`,
      title: `Welcome ${secret}`,
      text: 'visible page',
      elements: [
        { selector: '#token', visible: true, value: secret, text: secret },
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
      expect(snap.url).not.toContain(secret);
      expect(snap.title).not.toContain(secret);
      expect(snap.text).not.toContain(secret);
    }
  });

  it('redacts parameterized secrets from every snapshot.values entry (L7-161)', async () => {
    const secret = 's3cret-password';
    const step = fillStep(0, '#password', secret, 'password');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: Array<{ values: Record<string, string> }> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        if (context.afterDom !== undefined) {
          captured.push({ values: { ...context.afterDom.values } });
        }
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      text: 'visible page',
      elements: [
        { selector: '#password', visible: true, value: secret, text: secret },
        { selector: '#gone', visible: false }
      ]
    });
    const originalSnapshot = driver.snapshot.bind(driver);
    driver.snapshot = async () => {
      const snap = await originalSnapshot();
      return { ...snap, values: { ...snap.values, '#mirror': secret, '#note': `user ${secret}` } };
    };
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
      expect(snap.values['#mirror']).toBe('');
      expect(snap.values['#note']).not.toContain(secret);
    }
  });

  it('redacts lastError with the same parameter secrets before recovery (L7-194)', async () => {
    const secret = 's3cret-password';
    const step = fillStep(0, '#password', secret, 'password');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: string[] = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        captured.push(context.error);
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      text: 'visible page',
      elements: [
        { selector: '#password', visible: true, value: '', text: secret },
        { selector: '#gone', visible: false }
      ]
    });
    driver.fill = async () => {
      throw new Error(`fill failed for ${secret}`);
    };
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
    for (const error of captured) {
      expect(error).not.toContain(secret);
      expect(error).toMatch(/fill failed/);
    }
  });

  it('blanks every snapshot.values entry on parameterized recovery (R19a)', async () => {
    const secret = 's3cret-password';
    const step = fillStep(0, '#password', secret, 'password');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: Array<{ values: Record<string, string> }> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        if (context.afterDom !== undefined) {
          captured.push({ values: { ...context.afterDom.values } });
        }
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      text: 'visible page',
      elements: [
        { selector: '#password', visible: true, value: secret, text: secret },
        { selector: '#gone', visible: false }
      ]
    });
    const originalSnapshot = driver.snapshot.bind(driver);
    driver.snapshot = async () => {
      const snap = await originalSnapshot();
      return {
        ...snap,
        values: { '#pwd': secret, '#ok': 'visible', '#note': `user ${secret}` }
      };
    };
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
      expect(snap.values['#pwd']).toBe('');
      expect(snap.values['#ok']).toBe('');
      expect(snap.values['#note']).toBe('');
      expect(Object.values(snap.values).every((value) => value === '')).toBe(true);
    }
  });

  it('does not over-strip short PIN/OTP tokens from unrelated DOM words (L7-124)', async () => {
    const secret = 'ab';
    const step = fillStep(0, '#code', secret, 'code');
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
      text: 'visible about the table on page',
      elements: [
        { selector: '#code', visible: true, value: secret, text: secret },
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
      expect(snap.values['#code']).toBe('');
      expect(snap.text).toContain('about');
      expect(snap.text).toContain('table');
      expect(snap.text).not.toMatch(/(^|[^A-Za-z0-9])ab([^A-Za-z0-9]|$)/u);
    }
  });

  it('does not redact a single-char OTP digit as a word-boundary secret (L7-228)', async () => {
    const secret = '1';
    const step = fillStep(0, '#code', secret, 'code');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const captured: Array<{ text: string }> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        if (context.afterDom !== undefined) {
          captured.push({ text: context.afterDom.text });
        }
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      text: 'otp step 1 of 9 on page',
      elements: [
        { selector: '#code', visible: true, value: secret, text: secret },
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
      expect(snap.text).toContain('step 1 of 9');
    }
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(
      src,
      'function collectParameterSecrets',
      'function redactTextWithSecrets'
    );
    expect(fn).toContain('PARAMETER_SECRET_MIN_LENGTH');
    expect(fn).not.toMatch(/live\.length > 0/);
    expect(fn).not.toMatch(/argument\.length > 0/);
  });

  it('loads datasets through loadDatasetFile and skips parameterized shots from scenario.steps (L7-111 / L7-112)', async () => {
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toContain('await loadDatasetFile(absolute)');
    expect(src).not.toMatch(/JSON\.parse\(await readFile\(absolute/);
    expect(src).toContain('return scenario.steps.some(hasParameterRef)');
    expect(src).not.toContain('hasParameterRef(step) ||');
    const skipIdx = src.indexOf('skipParameterizedScreenshots(executable)');
    const loopIdx = src.indexOf('for (let index = 0; index < executable.steps.length');
    expect(skipIdx).toBeGreaterThan(-1);
    expect(loopIdx).toBeGreaterThan(skipIdx);
    expect(src).toContain('assertParameterRefsResolved(scenario)');
  });

  it('skips fail/recover screenshots for parameterRef steps (S11a)', async () => {
    const step = fillStep(0, '#password', 's3cret-password', 'password');
    step.verification.expected = '#gone';
    step.verification.timeoutMs = 40;
    const paths: Array<string | undefined> = [];
    const recoverer: Recoverer = {
      recover: async (context) => {
        paths.push(context.screenshotPath);
        return undefined;
      }
    };
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#password', visible: true, value: '' },
        { selector: '#gone', visible: false }
      ]
    });
    const reportDir = await tempDir('spyglass-lot7-s11a-');
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
        recoverer,
        reportDir
      }
    );
    expect(result.exitCode).toBe(1);
    expect(driver.screenshotWrites).toEqual([]);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path === undefined)).toBe(true);
    expect(result.report.steps[0]?.screenshotRef).toBeUndefined();
  });

  it('still captures recovery screenshots for non-parameterized steps (S11a)', async () => {
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#gone', visible: false },
        { selector: '#ok', visible: true }
      ]
    });
    driver.failSelectors.add('#gone');
    const step: RefinedStep = {
      index: 0,
      intent: 'Je clique',
      action: {
        type: 'click',
        descriptor: { type: 'click', selector: '#gone', selectorStrategy: 'css' }
      },
      verification: {
        type: 'elementVisible',
        expected: '#ok',
        strength: 'strong',
        confirmedByUser: true,
        timeoutMs: 40
      },
      sourceEvents: ['evt_000001']
    };
    const result = await runScenario(
      {
        schemaVersion: 1,
        sessionId: 'ses_params',
        startUrl: 'https://exemple.test/start',
        steps: [step]
      },
      {
        driver,
        aiRecovery: true,
        maxAiRetries: 1,
        env: {},
        recoverer: {
          recover: async () => undefined
        }
      }
    );
    expect(result.exitCode).toBe(1);
    expect(driver.screenshotWrites.length).toBeGreaterThan(0);
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

  it('writes dataset-load failure artifacts under runPath(reportDir, runId) (L7-256)', async () => {
    const reportDir = await tempDir('spyglass-lot7-l7256-');
    const extracted = extractScenarioParameters(loginScenario('alice', 's3cret'));
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#user', visible: true, value: '' },
        { selector: '#password', visible: true, value: '' }
      ]
    });
    const runId = 'run_l7256';
    const result = await runScenario(extracted.scenario, {
      driver,
      aiRecovery: false,
      datasetPath: join(reportDir, 'missing.json'),
      reportDir,
      runId
    });
    expect(result.exitCode).toBe(1);
    expect(result.runDir).toBe(join(reportDir, runId));
    const disk = JSON.parse(await readFile(join(reportDir, runId, 'report.json'), 'utf8')) as {
      runId: string;
      sessionId: string;
      warnings: string[];
    };
    expect(disk.runId).toBe(runId);
    expect(disk.sessionId).toBe(extracted.scenario.sessionId);
    expect(disk.warnings.join('\n')).toMatch(/dataset:/);
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(
      src,
      'async function datasetLoadFailure',
      'async function scenarioWithDataset'
    );
    expect(fn).toContain('runArtifactsDir');
    expect(fn).toContain('scenario: input.scenario');
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

  it('returns a failed ExecutionReport when parameterRef has no --dataset (D20a)', async () => {
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
      aiRecovery: false
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.steps).toEqual([]);
    expect(result.report.warnings.join('\n')).toMatch(
      /dataset: dataset is missing parameterRef: user, password/
    );
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

  it('refuses a file destination even when overwrite is set (O29b)', async () => {
    const root = await tempDir('spyglass-lot7-o29b-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await writeFile(dest, 'not-a-dir\n', 'utf8');
    await expect(exportSessionFolder(sessionDir, dest, { overwrite: true })).rejects.toThrow(
      /destination is not a directory/
    );
    expect(await readFile(dest, 'utf8')).toBe('not-a-dir\n');
    await expect(exportSessionFolder(sessionDir, dest)).rejects.toThrow(
      /destination is not a directory/
    );
    expect(await readFile(dest, 'utf8')).toBe('not-a-dir\n');
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const exportFn = sourceBetween(
      src,
      'export async function exportSessionFolder',
      'export async function importSessionFolder'
    );
    expect(exportFn).toContain('assertExportDestIsDirectoryIfPresent');
    const destCheck = exportFn.indexOf('assertExportDestIsDirectoryIfPresent');
    const overwriteIdx = exportFn.indexOf('if (!overwrite)');
    expect(destCheck).toBeGreaterThan(-1);
    expect(overwriteIdx).toBeGreaterThan(destCheck);
    const replaceFn = sourceBetween(src, 'async function replaceDirectory');
    const backupIdx = replaceFn.indexOf('const backup');
    expect(backupIdx).toBeGreaterThan(-1);
    const overwrite = replaceFn.slice(backupIdx);
    expect(replaceFn.indexOf('isDirectory()')).toBeGreaterThan(-1);
    expect(replaceFn.indexOf('isDirectory()')).toBeLessThan(backupIdx);
    expect(overwrite).toContain('await rename(dest, backup)');
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

  it('publishes overwrite-false export into an existing empty dest (W26a)', async () => {
    const root = await tempDir('spyglass-lot7-w26a-empty-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    await mkdir(dest, { recursive: true });
    const result = await exportSessionFolder(sessionDir, dest);
    expect(result.dest).toBe(dest);
    expect(await readFile(join(dest, 'raw.jsonl'), 'utf8')).toBe('{"schemaVersion":1}\n');
    expect(await readFile(join(dest, SESSION_BUNDLE_MANIFEST), 'utf8')).toMatch(/spyglass-session/);
  });

  it('still refuses import when an empty dest directory already exists (I7a)', async () => {
    const root = await tempDir('spyglass-lot7-w26a-import-empty-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    const sessionsRoot = join(root, 'imported');
    await mkdir(join(sessionsRoot, 'ses_export'), { recursive: true });
    await expect(importSessionFolder(dest, sessionsRoot)).rejects.toThrow(/session already exists/);
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

  it('refuses special files in assertNoSymlinks (L7-219)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const body = sourceBetween(
      src,
      'async function assertNoSymlinks',
      'async function realpathExisting'
    );
    expect(body).toContain('st.isFile()');
    expect(body).toContain('special files are not allowed');
    expect(body).toContain('SessionBundleError');
  });

  it.skipIf(process.platform === 'win32')(
    'refuses FIFO/socket/device files on export (L7-219)',
    async (ctx) => {
      const root = await tempDir('spyglass-lot7-l7219-');
      const sessionDir = join(root, 'ses_export');
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(sessionDir, 'meta.json'),
        `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
        'utf8'
      );
      const fifo = join(sessionDir, 'pipe');
      const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
      if (made.status !== 0) {
        ctx.skip();
        return;
      }
      await expect(exportSessionFolder(sessionDir, join(root, 'bundle'))).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof SessionBundleError &&
          err.bundleCode === 'symlink' &&
          /export refused: special files/.test(err.message)
      );
    }
  );

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
    await expect(importSessionFolder(dest, join(root, 'imported'))).rejects.toThrow(
      /import refused: symlinks/
    );
  });

  it('does not swallow permission errors in realpathExisting overlap guards (L7-177)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const body = sourceBetween(
      src,
      'async function realpathExisting',
      'function isMissingPathError'
    );
    expect(body).toContain('isMissingPathError');
    expect(body).not.toMatch(/catch \{/);
    expect(body).not.toMatch(/catch \([^)]*\) \{\s*return /);
    expect(body).toContain('if (!isMissingPathError(error))');
    expect(body).toContain('throw error');
    expect(body).toContain('throw parentError');
    const resolveIdx = body.lastIndexOf('return resolve(path)');
    expect(resolveIdx).toBeGreaterThan(body.indexOf('throw error'));
    expect(resolveIdx).toBeGreaterThan(body.indexOf('throw parentError'));
    const missing = sourceBetween(
      src,
      'function isMissingPathError',
      'async function vacateEmptyDirectory'
    );
    expect(missing).toContain("code === 'ENOENT'");
    expect(missing).toContain("code === 'ENOTDIR'");
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'does not swallow realpathExisting EACCES as session-exists (L7-280)',
    async () => {
      const root = await tempDir('spyglass-lot7-l7280-');
      const sessionDir = join(root, 'ses_export');
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(sessionDir, 'meta.json'),
        `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
        'utf8'
      );
      const bundle = join(root, 'bundle');
      await exportSessionFolder(sessionDir, bundle);
      const sessionsRoot = join(root, 'imported');
      const blocked = join(sessionsRoot, 'ses_export');
      await mkdir(blocked, { recursive: true });
      await chmod(blocked, 0);
      try {
        await expect(importSessionFolder(bundle, sessionsRoot)).rejects.toSatisfy(
          (err: unknown) => {
            const code = (err as NodeJS.ErrnoException).code;
            const message = err instanceof Error ? err.message : String(err);
            return (
              (code === 'EACCES' ||
                code === 'EPERM' ||
                /EACCES|EPERM|permission denied/i.test(message)) &&
              !/session already exists/.test(message)
            );
          }
        );
      } finally {
        await chmod(blocked, 0o700).catch(() => undefined);
      }
    }
  );

  it('does not map EPERM to destination already exists (L7-195)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const body = sourceBetween(src, 'async function replaceDirectory');
    const backupIdx = body.indexOf('const backup');
    expect(backupIdx).toBeGreaterThan(-1);
    const noOverwrite = body.slice(0, backupIdx);
    expect(noOverwrite).toContain('pathExists(dest)');
    expect(noOverwrite).not.toContain("code === 'EPERM'");
    const existsIdx = noOverwrite.indexOf('pathExists(dest)');
    const renameIdx = noOverwrite.indexOf('await rename(staging, dest)');
    expect(existsIdx).toBeGreaterThan(-1);
    expect(renameIdx).toBeGreaterThan(existsIdx);
  });

  it('vacates an empty dest before no-replace rename so Windows folder pickers work (W26a)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const body = sourceBetween(src, 'async function replaceDirectory');
    const backupIdx = body.indexOf('const backup');
    expect(backupIdx).toBeGreaterThan(-1);
    const noOverwrite = body.slice(0, backupIdx);
    expect(noOverwrite).toContain('allowEmptyDest');
    expect(noOverwrite).toContain('vacateEmptyDirectory(dest)');
    const vacateIdx = noOverwrite.indexOf('vacateEmptyDirectory(dest)');
    const existsIdx = noOverwrite.indexOf('pathExists(dest)');
    const renameIdx = noOverwrite.indexOf('await rename(staging, dest)');
    expect(vacateIdx).toBeGreaterThan(-1);
    expect(existsIdx).toBeGreaterThan(vacateIdx);
    expect(renameIdx).toBeGreaterThan(existsIdx);
    const vacate = sourceBetween(
      src,
      'async function vacateEmptyDirectory',
      'async function recoverOrphanedBackup'
    );
    expect(vacate).toContain('names.length > 0');
    expect(vacate).toContain('await rmdir(dest)');
    expect(vacate).not.toContain('recursive: true');
  });

  it('documents withDestLock as single-process in-memory only (X28a)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const map = src.indexOf('const destLocks = new Map<string, Promise<void>>()');
    expect(map).toBeGreaterThan(-1);
    const end = src.indexOf('function isSafeSessionId');
    expect(end).toBeGreaterThan(map);
    const headerStart = src.lastIndexOf('/**', map);
    expect(headerStart).toBeGreaterThan(-1);
    const header = src.slice(headerStart, end);
    expect(header).toMatch(/in-memory|single-process|this process/iu);
    expect(header).toMatch(/not a\s+cross-process lockfile|no lockfile/iu);
    expect(header).not.toMatch(/so concurrent import\/export cannot clobber\./u);
  });

  it('cleans destLocks using the same queued promise that was stored (L7-207)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const body = sourceBetween(src, 'async function withDestLock', 'function isSafeSessionId');
    expect(body).toContain('const queued = previous.then(() => held)');
    expect(body).toContain('destLocks.set(key, queued)');
    expect(body).toContain('destLocks.get(key) === queued');
    expect(body).not.toContain('destLocks.get(key) === held');
  });

  it('re-checks export staging for symlinks after copy (L7-208)', async () => {
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const body = sourceBetween(
      src,
      'export async function exportSessionFolder',
      'export async function importSessionFolder'
    );
    expect(body).toContain("assertNoSymlinks(source, 'export')");
    expect(body).toContain("assertNoSymlinks(staging, 'export')");
    expect(body.indexOf('await cp(source, staging')).toBeGreaterThan(-1);
    expect(body.indexOf('await cp(source, staging')).toBeLessThan(
      body.indexOf("assertNoSymlinks(staging, 'export')")
    );
  });

  it('does not follow a source spyglass-session.json symlink on export (L7-154)', async () => {
    const root = await tempDir('spyglass-lot7-l7154-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const leaked = join(root, 'outside.json');
    await writeFile(leaked, 'KEEP\n', 'utf8');
    await symlink(leaked, join(sessionDir, SESSION_BUNDLE_MANIFEST));
    const dest = join(root, 'bundle');
    await expect(exportSessionFolder(sessionDir, dest)).rejects.toThrow(/export refused: symlink/);
    expect(await readFile(leaked, 'utf8')).toBe('KEEP\n');
    await expect(readFile(join(dest, SESSION_BUNDLE_MANIFEST))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('refuses export of a session folder that contains a symlink (L7-188)', async () => {
    const root = await tempDir('spyglass-lot7-l7188-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await symlink(join(root, 'outside'), join(sessionDir, 'escape'));
    await expect(exportSessionFolder(sessionDir, join(root, 'bundle'))).rejects.toThrow(
      /export refused: symlink/
    );
  });

  it('refuses import when spyglass-session.json disagrees with meta.json (L7-187)', async () => {
    const root = await tempDir('spyglass-lot7-l7187-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    await writeFile(
      join(dest, SESSION_BUNDLE_MANIFEST),
      `${JSON.stringify({ schemaVersion: 1, kind: 'spyglass-session', sessionId: 'ses_other', exportedAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`,
      'utf8'
    );
    await expect(importSessionFolder(dest, join(root, 'imported'))).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SessionBundleError &&
        err.bundleCode === 'invalid-meta' &&
        /sessionId does not match meta.json/.test(err.message)
    );
  });

  it('tags missing/invalid bundle manifest as SessionBundleError invalid-meta (L7-258)', async () => {
    const root = await tempDir('spyglass-lot7-l7258-manifest-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    const dest = join(root, 'bundle');
    await exportSessionFolder(sessionDir, dest);
    await rm(join(dest, SESSION_BUNDLE_MANIFEST));
    await expect(importSessionFolder(dest, join(root, 'imported-missing'))).rejects.toSatisfy(
      (err: unknown) =>
        isSessionBundleError(err) &&
        err.bundleCode === 'invalid-meta' &&
        /missing spyglass-session.json/.test(err.message)
    );
    await writeFile(join(dest, SESSION_BUNDLE_MANIFEST), '{not json\n', 'utf8');
    await expect(importSessionFolder(dest, join(root, 'imported-bad'))).rejects.toSatisfy(
      (err: unknown) =>
        isSessionBundleError(err) &&
        err.bundleCode === 'invalid-meta' &&
        /invalid spyglass-session.json/.test(err.message)
    );
    const noMeta = join(root, 'no-meta');
    await mkdir(noMeta, { recursive: true });
    await expect(exportSessionFolder(noMeta, join(root, 'out'))).rejects.toSatisfy(
      (err: unknown) =>
        isSessionBundleError(err) &&
        err.bundleCode === 'invalid-meta' &&
        /meta.json is missing/.test(err.message)
    );
    const badMeta = join(root, 'bad-meta-dir');
    await mkdir(badMeta, { recursive: true });
    await writeFile(join(badMeta, 'meta.json'), '{not json\n', 'utf8');
    await expect(exportSessionFolder(badMeta, join(root, 'out-bad'))).rejects.toSatisfy(
      (err: unknown) =>
        isSessionBundleError(err) &&
        err.bundleCode === 'invalid-meta' &&
        /invalid JSON/.test(err.message)
    );
  });

  it('serializes concurrent imports so a dest created after the check is not replaced (L7-186)', async () => {
    const root = await tempDir('spyglass-lot7-l7186-');
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
    const results = await Promise.allSettled([
      importSessionFolder(dest, sessionsRoot),
      importSessionFolder(dest, sessionsRoot)
    ]);
    const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
    const rejected = results.filter((entry) => entry.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await readFile(join(sessionsRoot, 'ses_export', 'raw.jsonl'), 'utf8')).toBe(
      '{"schemaVersion":1}\n'
    );
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
    // L7-281: target is invalid for readSessionMeta so refusal cannot be
    // "read through the link, then later fail the walk".
    await writeFile(leaked, 'not-valid-session-meta\n', 'utf8');
    await rm(join(dest, 'meta.json'));
    await symlink(leaked, join(dest, 'meta.json'));
    await expect(importSessionFolder(dest, join(root, 'imported'))).rejects.toThrow(
      /import refused: symlinks/
    );
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

  it('does not resurrect an unrelated .spyglass-prev backup (L7-260)', async () => {
    const root = await tempDir('spyglass-lot7-l7260-');
    const sessionDir = join(root, 'ses_export');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      `${JSON.stringify({ sessionId: 'ses_export', schemaVersion: 1 }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(sessionDir, 'raw.jsonl'), '{"schemaVersion":1}\n', 'utf8');
    const dest = join(root, 'bundle');
    const unrelated = join(root, 'other.spyglass-prev-deadbeef');
    await mkdir(unrelated, { recursive: true });
    await writeFile(join(unrelated, 'keep.txt'), 'unrelated\n', 'utf8');
    const result = await exportSessionFolder(sessionDir, dest);
    expect(result.dest).toBe(dest);
    expect(await readFile(join(dest, 'raw.jsonl'), 'utf8')).toBe('{"schemaVersion":1}\n');
    expect(await readFile(join(unrelated, 'keep.txt'), 'utf8')).toBe('unrelated\n');
    const src = await readFile(new URL('./session-bundle.ts', import.meta.url), 'utf8');
    const fn = sourceBetween(
      src,
      'async function recoverOrphanedBackup',
      'async function replaceDirectory'
    );
    expect(fn).toContain('try {');
    expect(fn).toContain('await rename(newest.path, dest)');
    expect(fn).toContain('st.isDirectory()');
    expect(fn).toContain('ownedPrefix');
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
    expect(result.exitCode).toBe(0);
    expect(result.cancelled).toBe(true);
    expect(result.report.steps[1]?.status).toBe('cancelled');
    expect(result.report.steps[1]?.error).toMatch(/stopped by user/);
    expect(result.report.steps[0]?.status).toBe('passed');
  });
});
