import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RefinedStep, ReplayDescriptor, Scenario } from '@spyglass/contracts';
import { cloneDescriptor } from './scenario.ts';

export const DATASET_SCHEMA_VERSION = 1 as const;
export const DATASETS_DIR = 'datasets';

export type ScenarioDataset = {
  schemaVersion: 1;
  name: string;
  values: Record<string, string>;
  secrets: string[];
};

const SECRET_NAME = /pass|secret|token|pwd|motdepasse|mdp|otp|pin|cvv|apikey|api[_-]?key|ssn/iu;

export function parameterNameFromStep(step: RefinedStep, used: Set<string>): string | undefined {
  if (step.action.parameterRef !== undefined && step.action.parameterRef.trim().length > 0) {
    // R4a / R10a / D29a: explicit parameterRef is not unique-ified against
    // selector-derived names. Duplicate refs share one dataset variable
    // (extract last-write-wins; no conflict warn/error).
    return step.action.parameterRef.trim();
  }
  if (!isParameterizedType(step.action.type)) {
    return undefined;
  }
  const fromSelector = nameFromSelector(step.action.descriptor.selector);
  return uniqueName(fromSelector, used);
}

export function isParameterizedType(type: RefinedStep['action']['type']): boolean {
  return type === 'fill' || type === 'select';
}

export function extractScenarioParameters(scenario: Scenario): {
  scenario: Scenario;
  dataset: ScenarioDataset;
} {
  const used = new Set<string>();
  const values = emptyStringMap();
  const secrets: string[] = [];
  const steps = scenario.steps.map((step) => {
    if (!isParameterizedType(step.action.type)) {
      return step;
    }
    const recorded = step.action.descriptor.arguments?.[0];
    const name = parameterNameFromStep(step, used);
    if (name === undefined) {
      return step;
    }
    used.add(name);
    const value = typeof recorded === 'string' ? recorded : '';
    // R10a: shared explicit parameterRef last-write-wins; no conflict warn/error.
    setOwnString(values, name, value);
    if (isSecretParameterName(name) || looksMaskedParameterValue(value)) {
      if (!secrets.includes(name)) {
        secrets.push(name);
      }
    }
    const descriptor = cloneDescriptor(step.action.descriptor);
    // A27b / L7-070: drop the parameterized slot; keep trailing args.
    stripParameterizedArgument(descriptor);
    return {
      ...step,
      action: {
        ...step.action,
        parameterRef: name,
        descriptor
      }
    };
  });
  return {
    scenario: { ...scenario, steps },
    dataset: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      name: 'recorded',
      values,
      secrets
    }
  };
}

export function exampleDataset(recorded: ScenarioDataset): ScenarioDataset {
  const values = emptyStringMap();
  const secretSet = new Set(recorded.secrets);
  for (const [key, value] of Object.entries(recorded.values)) {
    setOwnString(values, key, secretSet.has(key) ? '' : distinctExampleValue(key, value));
  }
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    name: 'example',
    values,
    secrets: [...recorded.secrets]
  };
}

export function applyDataset(scenario: Scenario, dataset: ScenarioDataset): Scenario {
  const missing: string[] = [];
  const steps = scenario.steps.map((step) => {
    const ref = step.action.parameterRef;
    if (ref === undefined || ref.trim().length === 0) {
      return step;
    }
    if (!Object.hasOwn(dataset.values, ref)) {
      missing.push(ref);
      return step;
    }
    const value = dataset.values[ref] ?? '';
    const descriptor = cloneDescriptor(step.action.descriptor);
    applyParameterizedArgument(descriptor, value);
    return {
      ...step,
      action: {
        ...step.action,
        descriptor
      }
    };
  });
  if (missing.length > 0) {
    throwMissingParameterRefs(missing);
  }
  return { ...scenario, steps };
}

/**
 * D20a / P2a: a `parameterRef` must have a resolved fill/select value.
 * Missing `--dataset` is not a silent empty-arg replay.
 */
export function assertParameterRefsResolved(scenario: Scenario): void {
  const missing: string[] = [];
  for (const step of scenario.steps) {
    const ref = step.action.parameterRef;
    if (ref === undefined || ref.trim().length === 0) {
      continue;
    }
    if (isUnresolvedParameterArg(step.action.descriptor.arguments?.[0])) {
      missing.push(ref.trim());
    }
  }
  if (missing.length > 0) {
    throwMissingParameterRefs(missing);
  }
}

/**
 * A27b: parameterized fill/select uses arguments[0]; trailing slots stay put.
 * L7-070: with no trailing args, omit `arguments` so the recorded secret is gone.
 */
export function stripParameterizedArgument(descriptor: ReplayDescriptor): void {
  const trailing = trailingArguments(descriptor.arguments);
  if (trailing.length === 0) {
    delete descriptor.arguments;
    return;
  }
  descriptor.arguments = unappliedArguments(trailing);
}

function applyParameterizedArgument(descriptor: ReplayDescriptor, value: string): void {
  descriptor.arguments = [value, ...trailingArguments(descriptor.arguments)] as string[];
}

/**
 * A27b / L7-224: keep trailing slots (not only strings). JSON-serializable
 * values round-trip; functions/undefined are dropped.
 */
function trailingArguments(args: readonly unknown[] | undefined): unknown[] {
  const trailing: unknown[] = [];
  for (const item of (args ?? []).slice(1)) {
    const kept = cloneJsonArg(item);
    if (kept !== undefined) {
      trailing.push(kept);
    }
  }
  return trailing;
}

function cloneJsonArg(value: unknown): unknown {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      return undefined;
    }
    return JSON.parse(encoded) as unknown;
  } catch {
    return undefined;
  }
}

/** N29a: vacant [0] is JSON `null` (not omitted, not `""`) so trailing indices stay. D20a still fails. */
export function unappliedArguments(trailing: unknown[]): string[] {
  return [null as unknown as string, ...(trailing as string[])];
}

function isUnresolvedParameterArg(value: unknown): boolean {
  return value === undefined || value === null;
}

function throwMissingParameterRefs(refs: string[]): never {
  const unique = [...new Set(refs)];
  throw new Error(`dataset is missing parameterRef: ${unique.join(', ')}`);
}

export function parseDataset(value: unknown): ScenarioDataset {
  if (typeof value !== 'object' || value === null) {
    throw new Error('dataset is not an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error('dataset schemaVersion must be 1');
  }
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    throw new Error('dataset name is required');
  }
  if (typeof record.values !== 'object' || record.values === null || Array.isArray(record.values)) {
    throw new Error('dataset values must be an object');
  }
  const values = emptyStringMap();
  for (const [key, item] of Object.entries(record.values as Record<string, unknown>)) {
    if (typeof item !== 'string') {
      throw new Error(`dataset value ${key} must be a string`);
    }
    setOwnString(values, key, item);
  }
  if (!Array.isArray(record.secrets)) {
    throw new Error('dataset secrets must be an array of strings');
  }
  const secrets: string[] = [];
  for (const item of record.secrets) {
    if (typeof item !== 'string') {
      throw new Error('dataset secrets must be an array of strings');
    }
    secrets.push(item);
  }
  return {
    schemaVersion: 1,
    name: record.name.trim(),
    values,
    secrets
  };
}

export async function writeGeneratedDatasets(
  generatedDir: string,
  recorded: ScenarioDataset
): Promise<{ recorded: string; example: string }> {
  const dir = join(generatedDir, DATASETS_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // L7-152: recursive mkdir ignores mode when the dir already exists.
  // Windows chmod only toggles read-only; skip POSIX modes there.
  if (process.platform !== 'win32') {
    await chmod(dir, 0o700);
  }
  const recordedPath = join(dir, 'recorded.json');
  const examplePath = join(dir, 'example.json');
  // D11a / L7-137 / L7-226: recorded.json is plaintext captured values
  // (including secrets). Write a temp file, chmod 0o600, then rename so an
  // existing world-readable dest is never overwritten in place.
  const tmp = `${recordedPath}.tmp-${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(tmp, `${JSON.stringify(recorded, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    if (process.platform !== 'win32') {
      await chmod(tmp, 0o600);
    }
    if (process.platform === 'win32') {
      await rm(recordedPath, { force: true });
    }
    await rename(tmp, recordedPath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  if (process.platform !== 'win32') {
    await chmod(recordedPath, 0o600);
  }
  await writeFile(examplePath, `${JSON.stringify(exampleDataset(recorded), null, 2)}\n`, 'utf8');
  return { recorded: recordedPath, example: examplePath };
}

function nameFromSelector(selector: string): string {
  const testId = selector.match(/data-testid=["']([^"']+)["']/u);
  if (testId?.[1] !== undefined) {
    return slug(testId[1]);
  }
  const nameAttr = selector.match(/\[name=["']([^"']+)["']\]/u);
  if (nameAttr?.[1] !== undefined) {
    return slug(nameAttr[1]);
  }
  const id = selector.match(/^#([A-Za-z][\w-]*)/u);
  if (id?.[1] !== undefined) {
    return slug(id[1]);
  }
  return 'value';
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return cleaned.length > 0 ? cleaned : 'value';
}

function emptyStringMap(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

/** L7-102: own properties even when `key` is `__proto__` / `constructor`. */
function setOwnString(record: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}_${String(index)}`)) {
    index += 1;
  }
  return `${base}_${String(index)}`;
}

export function isSecretParameterName(name: string): boolean {
  return SECRET_NAME.test(name);
}

export function isSecretSelector(selector: string): boolean {
  return isSecretParameterName(selector) || isSecretParameterName(nameFromSelector(selector));
}

export function looksMaskedParameterValue(value: string): boolean {
  return value.includes('•') || value.startsWith('secret:');
}

/** Distinct from the recorded capture so `--dataset example.json` is a second dataset. */
function distinctExampleValue(key: string, recorded: string): string {
  const placeholder = `example_${key}`;
  return placeholder === recorded ? `${placeholder}_alt` : placeholder;
}
