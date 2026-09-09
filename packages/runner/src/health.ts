import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  migrateHealthPatchCandidates,
  type ScenarioHealth,
  type SuggestedPatch,
  type SuggestedPatchEntry,
  validateHealth
} from '@spyglass/contracts';
import { descriptorHash } from './descriptor-hash.ts';
import type { PatchPolicy } from './patch-config.ts';

export const HEALTH_FILE = 'health.json';
/** L7-148 / L7-211: bound stored runIds; consecutiveRuns matches that window. */
export const MAX_CANDIDATE_RUN_IDS = 32;

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

export { migrateHealthPatchCandidates } from '@spyglass/contracts';

export async function loadHealth(sessionDir: string, sessionId: string): Promise<ScenarioHealth> {
  let rawText: string;
  try {
    rawText = await readFile(healthFilePath(sessionDir), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return emptyHealth(sessionId);
    }
    throw new Error(`unreadable health.json: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('corrupt health.json: invalid JSON');
  }
  parsed = migrateHealthPatchCandidates(parsed);
  const checked = validateHealth(parsed);
  if (!checked.valid) {
    throw new Error('corrupt health.json: schema validation failed');
  }
  const health = (checked.data ?? parsed) as ScenarioHealth;
  if (health.sessionId !== sessionId) {
    throw new Error(`health.json sessionId mismatch: ${health.sessionId} !== ${sessionId}`);
  }
  return health;
}

export async function saveHealth(sessionDir: string, health: ScenarioHealth): Promise<string> {
  const checked = validateHealth(health);
  if (!checked.valid) {
    throw new Error('invalid health.json');
  }
  await mkdir(sessionDir, { recursive: true });
  const path = healthFilePath(sessionDir);
  const tmp = `${path}.tmp-${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(tmp, `${JSON.stringify(health, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return path;
}

/**
 * F-63 / L7-001: consecutiveRuns counts **distinct** run IDs that produced the
 * same descriptor. Re-processing the same suggested-patch (same runId) is a
 * no-op. A run that produces a different descriptor, or no descriptor patch
 * for that step, resets/invalidates the candidate. Isolated success never
 * reaches confirmRuns. L7-211: consecutiveRuns equals the retained `runIds`
 * window after the cap (recycled evicted ids cannot inflate the counter).
 */
export function recordSuggestedPatches(
  health: ScenarioHealth,
  suggested: SuggestedPatch,
  policy: PatchPolicy
): ScenarioHealth {
  if (health.sessionId.length > 0 && suggested.sessionId !== health.sessionId) {
    throw new Error(
      `suggested patch sessionId ${suggested.sessionId} does not match health.json ${health.sessionId}`
    );
  }
  const byStep = new Map(health.patchCandidates.map((entry) => [entry.stepIndex, entry]));
  const patchedSteps = new Set<number>();
  for (const patch of suggested.patches) {
    if (!isActionDescriptorPatch(patch)) {
      continue;
    }
    patchedSteps.add(patch.stepIndex);
    const hash = descriptorHash(patch.suggested);
    const previous = byStep.get(patch.stepIndex);
    if (previous === undefined || previous.descriptorHash !== hash) {
      byStep.set(patch.stepIndex, newCandidate(patch.stepIndex, hash, suggested.runId));
      continue;
    }
    const runIds = distinctRunIds(previous);
    // L7-166: any prior occurrence is a no-op (A→B→A must not inflate consecutiveRuns).
    if (runIds.includes(suggested.runId)) {
      continue;
    }
    runIds.push(suggested.runId);
    const retained = capRunIds(runIds);
    byStep.set(patch.stepIndex, {
      stepIndex: patch.stepIndex,
      descriptorHash: hash,
      consecutiveRuns: retained.length,
      lastRunId: suggested.runId,
      runIds: retained
    });
  }
  for (const stepIndex of [...byStep.keys()]) {
    if (!patchedSteps.has(stepIndex)) {
      byStep.delete(stepIndex);
    }
  }
  const next: ScenarioHealth = {
    ...health,
    sessionId: suggested.sessionId,
    patchCandidates: [...byStep.values()].sort((left, right) => left.stepIndex - right.stepIndex)
  };
  next.status = healthStatus(next.appliedPatches, policy);
  return next;
}

function newCandidate(stepIndex: number, descriptorHash: string, runId: string): PatchCandidate {
  return {
    stepIndex,
    descriptorHash,
    consecutiveRuns: 1,
    lastRunId: runId,
    runIds: [runId]
  };
}

function distinctRunIds(entry: PatchCandidate): string[] {
  if (entry.runIds !== undefined && entry.runIds.length > 0) {
    return [...entry.runIds];
  }
  return entry.lastRunId.length > 0 ? [entry.lastRunId] : [];
}

function capRunIds(runIds: string[]): string[] {
  if (runIds.length <= MAX_CANDIDATE_RUN_IDS) {
    return runIds;
  }
  return runIds.slice(-MAX_CANDIDATE_RUN_IDS);
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
    appliedPatches: health.appliedPatches + applied.size,
    patchCandidates: health.patchCandidates.filter((entry) => !applied.has(entry.stepIndex))
  };
  next.status = healthStatus(next.appliedPatches, policy);
  return next;
}
