import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Scenario, ScenarioHealth, SuggestedPatch } from '@spyglass/contracts';
import {
  type AssistedApplyResult,
  applyAssistedPatches,
  type HasOpenPr,
  type PreparePr
} from './assisted-apply.ts';
import { type GitExec, isGitApplyError } from './git-repo.ts';
import { loadHealth, recordSuggestedPatches, resolveSessionDir, saveHealth } from './health.ts';
import { type PatchPolicy, resolvePatchPolicy } from './patch-config.ts';
import { redactSuggestedPatchForPersistence } from './patch-redact.ts';

export type PatchLifecycleResult = {
  health?: ScenarioHealth;
  healthPath?: string;
  assistedApply?: AssistedApplyResult;
};

/**
 * After a run writes suggested-patch.json (still applied: false, F-57):
 * update health.json candidates (F-63 / F-65). If PATCH_ASSISTED_APPLY and
 * two consecutive matching descriptors, open the F-64 branch/PR path.
 */
export async function processSuggestedPatch(input: {
  suggested: SuggestedPatch;
  scenario: Scenario;
  policy?: PatchPolicy;
  env?: NodeJS.ProcessEnv;
  reportDir?: string;
  scenarioPath?: string;
  sessionDir?: string;
  git?: GitExec;
  preparePr?: PreparePr;
  hasOpenPr?: HasOpenPr;
}): Promise<PatchLifecycleResult> {
  const env = input.env ?? process.env;
  const policy = input.policy ?? resolvePatchPolicy(env, {});
  const sessionDir = resolveSessionDir({
    ...(input.reportDir !== undefined ? { reportDir: input.reportDir } : {}),
    ...(input.scenarioPath !== undefined ? { scenarioPath: input.scenarioPath } : {}),
    ...(input.sessionDir !== undefined ? { sessionDir: input.sessionDir } : {})
  });
  if (sessionDir === undefined) {
    return {};
  }
  const suggested = redactSuggestedPatchForPersistence(input.suggested, input.scenario);
  let health = await loadHealth(sessionDir, suggested.sessionId);
  // L7-028: empty patches still record — a clean run resets F-63 candidates.
  health = recordSuggestedPatches(health, suggested, policy);
  const healthPath = await saveHealth(sessionDir, health);
  const result: PatchLifecycleResult = { health, healthPath };
  if (!policy.assistedApply || suggested.patches.length === 0) {
    return result;
  }
  const scenarioPath = resolveScenarioPath(input.scenarioPath, policy.repo);
  if (scenarioPath === undefined) {
    // L7-078: assisted apply is on and there are patches — do not silently skip.
    result.assistedApply = {
      ok: false,
      code: 'missing-scenario-path',
      reason: 'assisted apply requires scenarioPath'
    };
    return result;
  }
  try {
    const applyInput: Parameters<typeof applyAssistedPatches>[0] = {
      health,
      suggested,
      scenario: input.scenario,
      scenarioPath,
      policy,
      env
    };
    if (input.git !== undefined) {
      applyInput.git = input.git;
    }
    if (input.preparePr !== undefined) {
      applyInput.preparePr = input.preparePr;
    }
    if (input.hasOpenPr !== undefined) {
      applyInput.hasOpenPr = input.hasOpenPr;
    }
    const assisted = await applyAssistedPatches(applyInput);
    result.assistedApply = assisted;
    if (assisted.ok) {
      result.health = assisted.health;
      result.healthPath = await saveHealth(sessionDir, assisted.health);
    }
  } catch (error) {
    result.assistedApply = {
      ok: false,
      code: isGitApplyError(error) ? 'git-error' : 'internal-error',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  return result;
}

function resolveScenarioPath(
  scenarioPath: string | undefined,
  repo: string | undefined
): string | undefined {
  if (scenarioPath === undefined || scenarioPath.length === 0) {
    return undefined;
  }
  if (isAbsolute(scenarioPath)) {
    return scenarioPath;
  }
  if (repo !== undefined && repo.length > 0) {
    return resolve(repo, scenarioPath);
  }
  return resolve(scenarioPath);
}

export async function loadDatasetFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
