/**
 * Lot 7 patch policy (PRD §7). PATCH_ASSISTED_APPLY never makes apply automatic
 * (F-62): it only opens the assisted branch + PR path after F-63 confirmation.
 */

export const PATCH_CONFIRM_RUNS_DEFAULT = 2;
export const PATCH_WARN_THRESHOLD_DEFAULT = 3;
export const PATCH_STALE_THRESHOLD_DEFAULT = 5;

export type PatchPolicy = {
  assistedApply: boolean;
  confirmRuns: number;
  warnThreshold: number;
  staleThreshold: number;
  repo?: string;
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes') {
    return true;
  }
  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function resolvePatchPolicy(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<PatchPolicy> = {}
): PatchPolicy {
  const repo = overrides.repo ?? nonempty(env.PATCH_TARGET_REPO);
  const policy: PatchPolicy = {
    assistedApply: overrides.assistedApply ?? parseBool(env.PATCH_ASSISTED_APPLY, false),
    confirmRuns:
      overrides.confirmRuns ?? parsePositiveInt(env.PATCH_CONFIRM_RUNS, PATCH_CONFIRM_RUNS_DEFAULT),
    warnThreshold:
      overrides.warnThreshold ??
      parsePositiveInt(env.PATCH_WARN_THRESHOLD, PATCH_WARN_THRESHOLD_DEFAULT),
    staleThreshold:
      overrides.staleThreshold ??
      parsePositiveInt(env.PATCH_STALE_THRESHOLD, PATCH_STALE_THRESHOLD_DEFAULT)
  };
  if (repo !== undefined) {
    policy.repo = repo;
  }
  return policy;
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
