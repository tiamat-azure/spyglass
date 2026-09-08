import { readFile } from 'node:fs/promises';
import type { RefinedStep, ReplayDescriptor, Scenario } from '@spyglass/contracts';
import { validateScenario } from '@spyglass/contracts';

export type ScenarioRevisionLike = {
  sessionId: string;
  model?: string;
  createdAt?: string;
  steps: RefinedStep[];
};

export function asScenario(value: unknown, fallbackStartUrl?: string): Scenario {
  if (typeof value !== 'object' || value === null) {
    throw new Error('scenario is not an object');
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.steps) && typeof record.sessionId === 'string') {
    const startUrl =
      typeof record.startUrl === 'string' && record.startUrl.length > 0
        ? record.startUrl
        : fallbackStartUrl;
    if (startUrl === undefined || startUrl.length === 0) {
      throw new Error('scenario is missing startUrl');
    }
    const scenario: Scenario = {
      schemaVersion: 1,
      sessionId: record.sessionId,
      startUrl,
      steps: record.steps as RefinedStep[]
    };
    if (typeof record.generatedAt === 'string') {
      scenario.generatedAt = record.generatedAt;
    } else if (typeof record.createdAt === 'string') {
      scenario.generatedAt = record.createdAt;
    }
    if (typeof record.model === 'string') {
      scenario.model = record.model;
    }
    const checked = validateScenario(scenario);
    if (!checked.valid && !isRefinedRevision(record)) {
      throw new Error('invalid scenario.json');
    }
    return scenario;
  }
  throw new Error('invalid scenario document');
}

export function scenarioFromRevision(revision: ScenarioRevisionLike, startUrl: string): Scenario {
  const scenario: Scenario = {
    schemaVersion: 1,
    sessionId: revision.sessionId,
    startUrl,
    steps: revision.steps
  };
  if (revision.createdAt !== undefined) {
    scenario.generatedAt = revision.createdAt;
  }
  if (revision.model !== undefined) {
    scenario.model = revision.model;
  }
  return scenario;
}

export async function loadScenarioFile(
  filePath: string,
  fallbackStartUrl?: string
): Promise<Scenario> {
  const raw = await readFile(filePath, 'utf8');
  return asScenario(JSON.parse(raw) as unknown, fallbackStartUrl);
}

export function cloneDescriptor(descriptor: ReplayDescriptor): ReplayDescriptor {
  return structuredClone(descriptor);
}

function isRefinedRevision(record: Record<string, unknown>): boolean {
  return typeof record.revision === 'number' && Array.isArray(record.steps);
}
