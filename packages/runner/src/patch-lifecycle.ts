import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Scenario, ScenarioHealth, SuggestedPatch } from '@spyglass/contracts';
import {
  type AssistedApplyResult,
  applyAssistedPatches,
  type CreatePr,
  type HasOpenPr,
  isInsideRepo,
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
  createPr?: CreatePr;
}): Promise<PatchLifecycleResult> {
  const env = input.env ?? process.env;
  const policy = input.policy ?? resolvePatchPolicy(env, {});
  const sessionDir = resolveSessionDir({
    ...(input.reportDir !== undefined ? { reportDir: input.reportDir } : {}),
    ...(input.scenarioPath !== undefined ? { scenarioPath: input.scenarioPath } : {}),
    ...(input.sessionDir !== undefined ? { sessionDir: input.sessionDir } : {})
  });
  if (sessionDir === undefined) {
    // A30a: do not silently skip apply, and do not apply without sessionDir.
    if (policy.assistedApply) {
      return {
        assistedApply: {
          ok: false,
          code: 'missing-session-dir',
          reason: 'assisted apply requires sessionDir'
        }
      };
    }
    return {};
  }
  const persisted = redactSuggestedPatchForPersistence(input.suggested, input.scenario);
  let health = await loadHealth(sessionDir, persisted.sessionId);
  // L7-028 / L7-153: empty patches still record on a clean success — that run resets F-63 candidates.
  health = recordSuggestedPatches(health, persisted, policy);
  const healthPath = await saveHealth(sessionDir, health);
  const result: PatchLifecycleResult = { health, healthPath };
  if (!policy.assistedApply || persisted.patches.length === 0) {
    return result;
  }
  const resolvedPath = resolveScenarioPath(input.scenarioPath, policy.repo);
  if (!resolvedPath.ok) {
    // L7-078 / S28b: assisted apply is on and there are patches — do not silently skip.
    result.assistedApply = {
      ok: false,
      code: resolvedPath.code,
      reason: resolvedPath.reason
    };
    return result;
  }
  const scenarioPath = resolvedPath.path;
  try {
    const applyInput: Parameters<typeof applyAssistedPatches>[0] = {
      health,
      // L7-230: apply the live suggested patch; `persisted` is health/artifacts only.
      suggested: input.suggested,
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
    if (input.createPr !== undefined) {
      applyInput.createPr = input.createPr;
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

export type ResolveScenarioPathResult =
  | { ok: true; path: string }
  | {
      ok: false;
      code: 'missing-scenario-path' | 'scenario-outside-repo';
      reason: string;
    };

/**
 * S28b: do not assume the scenario/script lives under `--repo`. Relative
 * paths still resolve against the repo (L7-036), but a result outside
 * `policy.repo` is a structured refusal.
 */
export function resolveScenarioPath(
  scenarioPath: string | undefined,
  repo: string | undefined
): ResolveScenarioPathResult {
  if (scenarioPath === undefined || scenarioPath.length === 0) {
    return {
      ok: false,
      code: 'missing-scenario-path',
      reason: 'assisted apply requires scenarioPath'
    };
  }
  const resolved =
    !isAbsolute(scenarioPath) && repo !== undefined && repo.length > 0
      ? resolve(repo, scenarioPath)
      : resolve(scenarioPath);
  if (repo !== undefined && repo.length > 0) {
    const repoAbs = resolve(repo);
    if (!isInsideRepo(repoAbs, resolved)) {
      return {
        ok: false,
        code: 'scenario-outside-repo',
        reason: 'F-64: scenarioPath resolves outside the target --repo'
      };
    }
  }
  return { ok: true, path: resolved };
}

export async function loadDatasetFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
