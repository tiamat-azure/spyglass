import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ScenarioHealth, SuggestedPatch, SuggestedPatchEntry } from '@spyglass/contracts';
import { validateHealth } from '@spyglass/contracts';
import { descriptorHash } from './descriptor-hash.ts';
import type { PatchPolicy } from './patch-config.ts';

export const HEALTH_FILE = 'health.json';

export type PatchCandidate = ScenarioHealth['patchCandidates'][number];

export function emptyHealth(sessionId: string): ScenarioHealth {
  return {
    schemaVersion: 1,
    sessionId,
    status: 'healthy',
    appliedPatches: 0,
    patchCandidates: []
  };
}

export function healthStatus(
  appliedPatches: number,
  policy: PatchPolicy
): ScenarioHealth['status'] {
  if (appliedPatches >= policy.staleThreshold) {
    return 'stale';
  }
  if (appliedPatches >= policy.warnThreshold) {
    return 'fragile';
  }
  return 'healthy';
}

export function healthFilePath(sessionDir: string): string {
  return join(sessionDir, HEALTH_FILE);
}

/**
 * Session root from a run report dir (`sessions/<id>/runs/<runId>`) or a
 * generated scenario path (`sessions/<id>/generated/scenario.json`).
 */
export function resolveSessionDir(input: {
  reportDir?: string;
  scenarioPath?: string;
  sessionDir?: string;
}): string | undefined {
  if (input.sessionDir !== undefined && input.sessionDir.length > 0) {
    return input.sessionDir;
  }
  if (input.reportDir !== undefined && input.reportDir.length > 0) {
    const runParent = dirname(input.reportDir);
    if (basename(runParent) === 'runs') {
      return dirname(runParent);
    }
  }
  if (input.scenarioPath !== undefined && input.scenarioPath.length > 0) {
    const parent = dirname(input.scenarioPath);
    if (basename(parent) === 'generated') {
      return dirname(parent);
    }
  }
  return undefined;
}

export async function loadHealth(sessionDir: string, sessionId: string): Promise<ScenarioHealth> {
  try {
    const raw = JSON.parse(await readFile(healthFilePath(sessionDir), 'utf8')) as unknown;
    const checked = validateHealth(raw);
    if (checked.valid) {
      return raw as ScenarioHealth;
    }
  } catch {
    // missing or corrupt → start empty (session-scoped counters)
  }
  return emptyHealth(sessionId);
}

export async function saveHealth(sessionDir: string, health: ScenarioHealth): Promise<string> {
  const checked = validateHealth(health);
  if (!checked.valid) {
    throw new Error('invalid health.json');
  }
  await mkdir(sessionDir, { recursive: true });
  const path = healthFilePath(sessionDir);
  await writeFile(path, `${JSON.stringify(health, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * F-63: increment consecutiveRuns when the same descriptor hash repeats for a
 * step; reset to 1 when a run produces a different descriptor. Isolated
 * success never reaches confirmRuns.
 */
export function recordSuggestedPatches(
  health: ScenarioHealth,
  suggested: SuggestedPatch,
  policy: PatchPolicy
): ScenarioHealth {
  const byStep = new Map(health.patchCandidates.map((entry) => [entry.stepIndex, entry]));
  for (const patch of suggested.patches) {
    if (!isActionDescriptorPatch(patch)) {
      continue;
    }
    const hash = descriptorHash(patch.suggested);
    const previous = byStep.get(patch.stepIndex);
    if (previous === undefined || previous.descriptorHash !== hash) {
      byStep.set(patch.stepIndex, {
        stepIndex: patch.stepIndex,
        descriptorHash: hash,
        consecutiveRuns: 1,
        lastRunId: suggested.runId
      });
      continue;
    }
    byStep.set(patch.stepIndex, {
      stepIndex: patch.stepIndex,
      descriptorHash: hash,
      consecutiveRuns: previous.consecutiveRuns + 1,
      lastRunId: suggested.runId
    });
  }
  const next: ScenarioHealth = {
    ...health,
    sessionId: suggested.sessionId,
    patchCandidates: [...byStep.values()].sort((left, right) => left.stepIndex - right.stepIndex)
  };
  next.status = healthStatus(next.appliedPatches, policy);
  return next;
}

export function isActionDescriptorPatch(patch: SuggestedPatchEntry): boolean {
  return patch.scope === 'action.descriptor';
}

export function promotedCandidates(health: ScenarioHealth, policy: PatchPolicy): PatchCandidate[] {
  return health.patchCandidates.filter((entry) => entry.consecutiveRuns >= policy.confirmRuns);
}

export function incrementAppliedPatches(
  health: ScenarioHealth,
  appliedStepIndexes: readonly number[],
  policy: PatchPolicy
): ScenarioHealth {
  const applied = new Set(appliedStepIndexes);
  const next: ScenarioHealth = {
    ...health,
    appliedPatches: health.appliedPatches + appliedStepIndexes.length,
    patchCandidates: health.patchCandidates.filter((entry) => !applied.has(entry.stepIndex))
  };
  next.status = healthStatus(next.appliedPatches, policy);
  return next;
}
