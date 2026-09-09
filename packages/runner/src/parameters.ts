import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { cloneDescriptor } from './scenario.ts';

export const DATASET_SCHEMA_VERSION = 1 as const;
export const DATASETS_DIR = 'datasets';

export type ScenarioDataset = {
  schemaVersion: 1;
  name: string;
  values: Record<string, string>;
  secrets: string[];
};

const SECRET_NAME = /pass|secret|token|pwd|motdepasse|mdp/iu;

export function parameterNameFromStep(step: RefinedStep, used: Set<string>): string | undefined {
  if (step.action.parameterRef !== undefined && step.action.parameterRef.trim().length > 0) {
    return uniqueName(step.action.parameterRef.trim(), used);
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
  const values: Record<string, string> = {};
  const secrets: string[] = [];
  const used = new Set<string>();
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
    const value = recorded ?? '';
    values[name] = value;
    if (isSecretName(name) || looksMasked(value)) {
      secrets.push(name);
    }
    return {
      ...step,
      action: {
        ...step.action,
        parameterRef: name,
        descriptor: cloneDescriptor(step.action.descriptor)
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
  const values: Record<string, string> = {};
  const secretSet = new Set(recorded.secrets);
  for (const [key, value] of Object.entries(recorded.values)) {
    values[key] = secretSet.has(key) ? '' : distinctExampleValue(key, value);
  }
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    name: 'example',
    values,
    secrets: [...recorded.secrets]
  };
}

export function applyDataset(scenario: Scenario, dataset: ScenarioDataset): Scenario {
  return {
    ...scenario,
    steps: scenario.steps.map((step) => {
      const ref = step.action.parameterRef;
      if (ref === undefined || !Object.hasOwn(dataset.values, ref)) {
        return step;
      }
      const value = dataset.values[ref] ?? '';
      const descriptor = cloneDescriptor(step.action.descriptor);
      descriptor.arguments = [value];
      return {
        ...step,
        action: {
          ...step.action,
          descriptor
        }
      };
    })
  };
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
  const values: Record<string, string> = {};
  for (const [key, item] of Object.entries(record.values as Record<string, unknown>)) {
    if (typeof item !== 'string') {
      throw new Error(`dataset value ${key} must be a string`);
    }
    values[key] = item;
  }
  const secrets = Array.isArray(record.secrets)
    ? record.secrets.filter((item): item is string => typeof item === 'string')
    : [];
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
  await mkdir(dir, { recursive: true });
  const recordedPath = join(dir, 'recorded.json');
  const examplePath = join(dir, 'example.json');
  await writeFile(recordedPath, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8');
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

function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

function looksMasked(value: string): boolean {
  return value.includes('•') || value.startsWith('secret:');
}

/** Distinct from the recorded capture so `--dataset example.json` is a second dataset. */
function distinctExampleValue(key: string, recorded: string): string {
  const placeholder = `example_${key}`;
  return placeholder === recorded ? `${placeholder}_alt` : placeholder;
}
