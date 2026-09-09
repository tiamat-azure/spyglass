import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  RefinedStep,
  ReplayDescriptor,
  Scenario,
  ScenarioHealth,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { descriptorHash, patchSetHash } from './descriptor-hash.ts';
import {
  currentBranch,
  defaultGitExec,
  detectDefaultBranch,
  GitApplyError,
  type GitExec,
  isDefaultBranchName,
  isGitApplyError,
  isWorktreeDirty,
  patchBranchName
} from './git-repo.ts';
import { incrementAppliedPatches, promotedCandidates } from './health.ts';
import type { PatchPolicy } from './patch-config.ts';
import { asScenario, cloneDescriptor } from './scenario.ts';

export const ACTION_DESCRIPTOR_SCOPE = 'action.descriptor' as const;

export type AssistedApplyRefusal = {
  ok: false;
  reason: string;
  code:
    | 'disabled'
    | 'stale'
    | 'not-confirmed'
    | 'illegal-scope'
    | 'dirty-worktree'
    | 'default-branch'
    | 'missing-repo'
    | 'scenario-outside-repo'
    | 'no-matching-patch'
    | 'missing-scenario-path'
    | 'git-error'
    | 'internal-error'
    | 'type-mismatch'
    | 'pr-prep-failed';
  /** P12a: set when the local patch commit succeeded but PR prep failed. */
  branch?: string;
  commit?: string;
  health?: ScenarioHealth;
};

export type AssistedApplySuccess = {
  ok: true;
  branch: string;
  defaultBranch: string;
  commit: string;
  scenarioPath: string;
  prUrl?: string;
  prPrepared: boolean;
  merged: false;
  appliedStepIndexes: number[];
  health: ScenarioHealth;
};

export type AssistedApplyResult = AssistedApplySuccess | AssistedApplyRefusal;

export type PreparePr = (input: {
  repo: string;
  branch: string;
  defaultBranch: string;
  title: string;
  body: string;
}) => Promise<{ url?: string }>;

/**
 * F-62: only action.descriptor may be assisted-applied. Verification and
 * scenario structure (add/remove/reorder) are proposal-only forever. There is
 * no env/config escape hatch — PATCH_ALLOW_* is ignored if present.
 */
export function assertAssistedApplyAllowed(
  patch: SuggestedPatchEntry,
  env: NodeJS.ProcessEnv = process.env
): { ok: true } | { ok: false; reason: string } {
  void env.PATCH_ALLOW_VERIFICATION;
  void env.PATCH_ALLOW_STRUCTURE;
  void env.PATCH_ALLOW_ANY_SCOPE;
  if (patch.scope !== ACTION_DESCRIPTOR_SCOPE) {
    return {
      ok: false,
      reason:
        'F-62: only action.descriptor may be assisted-applied; other scopes stay proposal-only forever'
    };
  }
  return { ok: true };
}

export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Repo root itself is a valid parent of `scenario.json` at the worktree top. */
export function isSameOrInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || isPathInside(root, target);
}

/** Lexical containment (tests / callers that already resolved real paths). */
export function isInsideRepo(repoRoot: string, filePath: string): boolean {
  return isPathInside(resolve(repoRoot), resolve(filePath));
}

/**
 * L7-009: follow symlinks for the repo, the scenario file, and its parent.
 * A worktree-relative scenario.json that points outside `--repo` is refused.
 */
export async function resolveScenarioInRepo(
  repoRoot: string,
  scenarioPath: string
): Promise<{ gitCwd: string; repoReal: string; scenarioReal: string } | undefined> {
  try {
    const gitCwd = resolve(repoRoot);
    let repoReal: string;
    try {
      repoReal = await realpath(gitCwd);
    } catch {
      return undefined;
    }
    const requested = isAbsolute(scenarioPath)
      ? resolve(scenarioPath)
      : resolve(repoRoot, scenarioPath);
    const scenarioReal = await realpathExisting(requested);
    if (scenarioReal === undefined) {
      return undefined;
    }
    let parentReal: string;
    try {
      parentReal = await realpath(dirname(requested));
    } catch {
      parentReal = dirname(scenarioReal);
    }
    if (!isPathInside(repoReal, scenarioReal) || !isSameOrInside(repoReal, parentReal)) {
      return undefined;
    }
    return { gitCwd, repoReal, scenarioReal };
  } catch {
    return undefined;
  }
}

async function realpathExisting(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    try {
      const parent = await realpath(dirname(path));
      return join(parent, basename(path));
    } catch {
      return undefined;
    }
  }
}

export async function applyAssistedPatches(input: {
  health: ScenarioHealth;
  suggested: SuggestedPatch;
  scenario: Scenario;
  scenarioPath: string;
  policy: PatchPolicy;
  env?: NodeJS.ProcessEnv;
  git?: GitExec;
  preparePr?: PreparePr;
  now?: Date;
}): Promise<AssistedApplyResult> {
  const env = input.env ?? process.env;
  const policy = input.policy;
  if (!policy.assistedApply) {
    return { ok: false, reason: 'PATCH_ASSISTED_APPLY is false', code: 'disabled' };
  }
  if (input.health.status === 'stale') {
    return {
      ok: false,
      reason: 'scenario is stale (F-65); re-record required before further assisted apply',
      code: 'stale'
    };
  }
  const repo = policy.repo;
  if (repo === undefined || repo.length === 0) {
    return {
      ok: false,
      reason: 'F-64: --repo / PATCH_TARGET_REPO is required',
      code: 'missing-repo'
    };
  }
  const repoRoot = resolve(repo);
  const resolvedScenario = await resolveScenarioInRepo(repoRoot, input.scenarioPath);
  if (resolvedScenario === undefined) {
    return {
      ok: false,
      reason: 'F-64: scenario.json must live inside the target --repo',
      code: 'scenario-outside-repo'
    };
  }
  const scenarioPath = resolvedScenario.scenarioReal;

  const promoted = promotedCandidates(input.health, policy);
  if (promoted.length === 0) {
    return {
      ok: false,
      reason: 'F-63: isolated success never promotes; need consecutive matching descriptors',
      code: 'not-confirmed'
    };
  }

  const toApply: Array<{ stepIndex: number; suggested: ReplayDescriptor; hash: string }> = [];
  for (const candidate of promoted) {
    const patch = input.suggested.patches.find((entry) => entry.stepIndex === candidate.stepIndex);
    if (patch === undefined) {
      continue;
    }
    const allowed = assertAssistedApplyAllowed(patch, env);
    if (!allowed.ok) {
      return { ok: false, reason: allowed.reason, code: 'illegal-scope' };
    }
    const hash = descriptorHash(patch.suggested);
    if (hash !== candidate.descriptorHash) {
      continue;
    }
    toApply.push({ stepIndex: candidate.stepIndex, suggested: patch.suggested, hash });
  }
  if (toApply.length === 0) {
    return {
      ok: false,
      reason: 'no confirmed action.descriptor patch on this run',
      code: 'no-matching-patch'
    };
  }

  const git = input.git ?? defaultGitExec;
  if (await isWorktreeDirty(git, repoRoot)) {
    return { ok: false, reason: 'F-64: refusing dirty worktree', code: 'dirty-worktree' };
  }

  const defaultBranch = await detectDefaultBranch(git, repoRoot);
  const startingBranch = await currentBranch(git, repoRoot);
  const hash = patchSetHash(toApply);
  const branch = patchBranchName(input.suggested.sessionId, hash);

  // L7-084 / P12a: a prior ok:false / pr-prep-failed attempt leaves spyglass/patch-* around.
  // Reuse it and resume PR prep instead of failing checkout -b.
  let skipMutate = false;
  if (await localBranchExists(git, repoRoot, branch)) {
    const ontoPatch = await checkoutOrGitError(git, repoRoot, startingBranch, ['checkout', branch]);
    if (ontoPatch !== undefined) {
      return ontoPatch;
    }
    try {
      const onPatch = await loadScenarioJson(scenarioPath);
      if (scenarioHasAppliedPatches(onPatch, toApply)) {
        skipMutate = true;
      } else {
        const ontoDefault = await checkoutOrGitError(git, repoRoot, startingBranch, [
          'checkout',
          '-f',
          defaultBranch
        ]);
        if (ontoDefault !== undefined) {
          return ontoDefault;
        }
        const deleted = await git(['branch', '-D', branch], repoRoot);
        if (deleted.code !== 0) {
          const revertError = await restoreStartingBranch(git, repoRoot, startingBranch);
          return refusalWithRestore(
            {
              ok: false,
              code: 'git-error',
              reason: deleted.stderr.trim() || `git branch -D ${branch} failed`
            },
            revertError,
            startingBranch
          );
        }
      }
    } catch (error) {
      const revertError = await restoreStartingBranch(git, repoRoot, startingBranch);
      return refusalWithRestore(
        {
          ok: false,
          code: 'internal-error',
          reason: error instanceof Error ? error.message : String(error)
        },
        revertError,
        startingBranch
      );
    }
  }

  let scenario = input.scenario;
  let commit: string;
  if (skipMutate) {
    commit = (await gitOkOrThrow(git, repoRoot, ['rev-parse', 'HEAD'])).trim();
  } else {
    if (startingBranch !== defaultBranch) {
      const headNow = await currentBranch(git, repoRoot);
      if (headNow !== defaultBranch) {
        const switched = await checkoutOrGitError(git, repoRoot, startingBranch, [
          'checkout',
          defaultBranch
        ]);
        if (switched !== undefined) {
          return switched;
        }
      }
      try {
        scenario = await loadScenarioJson(scenarioPath);
      } catch (error) {
        const revertError = await restoreStartingBranch(git, repoRoot, startingBranch);
        return refusalWithRestore(
          {
            ok: false,
            code: 'internal-error',
            reason: error instanceof Error ? error.message : String(error)
          },
          revertError,
          startingBranch
        );
      }
    }
    const created = await checkoutOrGitError(git, repoRoot, startingBranch, [
      'checkout',
      '-b',
      branch
    ]);
    if (created !== undefined) {
      return created;
    }
    const onBranch = await currentBranch(git, repoRoot);
    if (isDefaultBranchName(onBranch, defaultBranch)) {
      const revertError = await restoreStartingBranch(git, repoRoot, startingBranch, branch);
      return refusalWithRestore(
        { ok: false, reason: 'F-64: never commit the default branch', code: 'default-branch' },
        revertError,
        startingBranch
      );
    }

    const typeMismatch = typeMismatchForApply(scenario, toApply);
    if (typeMismatch !== undefined) {
      const revertError = await restoreStartingBranch(git, repoRoot, startingBranch, branch);
      return refusalWithRestore(typeMismatch, revertError, startingBranch);
    }

    try {
      const patched = applyDescriptorsToScenario(scenario, toApply, {
        runId: input.suggested.runId,
        date: (input.now ?? new Date()).toISOString(),
        branch
      });
      await writeFile(scenarioPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');

      const rel = relative(resolvedScenario.repoReal, scenarioPath).split(sep).join('/');
      await gitOkOrThrow(git, repoRoot, ['add', '--', rel]);
      const message = `fix(spyglass): assisted action.descriptor patch for ${input.suggested.sessionId}\n\nHuman review required (F-64). CI green is not merge.`;
      await gitOkOrThrow(git, repoRoot, ['commit', '-m', message]);
      commit = (await gitOkOrThrow(git, repoRoot, ['rev-parse', 'HEAD'])).trim();
    } catch (error) {
      const revertError = await restoreStartingBranch(git, repoRoot, startingBranch, branch);
      if (revertError === undefined) {
        throw error;
      }
      const base = error instanceof Error ? error.message : String(error);
      const thrown = `${base}; also failed to restore ${startingBranch}: ${revertError}`;
      throw isGitApplyError(error) ? new GitApplyError(thrown) : new Error(thrown);
    }
  }

  const title = `spyglass: assisted descriptor patch (${input.suggested.sessionId})`;
  const body = [
    'Assisted apply of an `action.descriptor` patch (ADR-0008 / F-62–F-64).',
    '',
    `- Session: \`${input.suggested.sessionId}\``,
    `- Run: \`${input.suggested.runId}\``,
    `- Steps: ${toApply.map((item) => String(item.stepIndex)).join(', ')}`,
    '',
    '**Do not merge without human review.** A green CI does not validate a scenario that changed itself.',
    '',
    'Verification criteria and scenario structure remain proposal-only (CA-14 / F-62).'
  ].join('\n');

  let prUrl: string | undefined;
  if (input.preparePr !== undefined) {
    try {
      const prepared = await input.preparePr({
        repo: repoRoot,
        branch,
        defaultBranch,
        title,
        body
      });
      if (prepared.url !== undefined && prepared.url.length > 0) {
        prUrl = prepared.url;
      }
    } catch (error) {
      return prPrepFailed({
        branch,
        commit,
        health: input.health,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    const pushed = await pushPatchBranch(git, repoRoot, branch);
    if (!pushed) {
      return prPrepFailed({
        branch,
        commit,
        health: input.health,
        reason: 'git push failed'
      });
    }
    const gh = await tryGhPrCreate({ repo: repoRoot, branch, defaultBranch, title, body });
    if (!gh.ok) {
      return prPrepFailed({
        branch,
        commit,
        health: input.health,
        reason: 'gh pr create failed'
      });
    }
    if (gh.url !== undefined && gh.url.length > 0) {
      prUrl = gh.url;
    }
  }

  const health = incrementAppliedPatches(
    input.health,
    toApply.map((item) => item.stepIndex),
    policy
  );

  const result: AssistedApplySuccess = {
    ok: true,
    branch,
    defaultBranch,
    commit,
    scenarioPath,
    prPrepared: true,
    merged: false,
    appliedStepIndexes: toApply.map((item) => item.stepIndex),
    health
  };
  if (prUrl !== undefined) {
    result.prUrl = prUrl;
  }
  return result;
}

async function localBranchExists(git: GitExec, cwd: string, branch: string): Promise<boolean> {
  const result = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
  return result.code === 0;
}

function scenarioHasAppliedPatches(
  scenario: Scenario,
  patches: ReadonlyArray<{ stepIndex: number; hash: string }>
): boolean {
  return patches.every((patch) => {
    const step = scenario.steps.find((entry) => entry.index === patch.stepIndex);
    return step !== undefined && descriptorHash(step.action.descriptor) === patch.hash;
  });
}

function applyDescriptorsToScenario(
  scenario: Scenario,
  patches: ReadonlyArray<{ stepIndex: number; suggested: ReplayDescriptor; hash: string }>,
  history: { runId: string; date: string; branch: string }
): Scenario {
  const steps = scenario.steps.map((step) => {
    const patch = patches.find((entry) => entry.stepIndex === step.index);
    if (patch === undefined) {
      return step;
    }
    return withDescriptorHistory(step, patch.suggested, history);
  });
  return { ...scenario, steps };
}

function withDescriptorHistory(
  step: RefinedStep,
  suggested: ReplayDescriptor,
  history: { runId: string; date: string; branch: string }
): RefinedStep {
  const patchHistory = [
    ...(step.patchHistory ?? []),
    {
      runId: history.runId,
      date: history.date,
      scope: ACTION_DESCRIPTOR_SCOPE,
      reviewedBy: 'pending-human-review',
      pullRequest: `branch:${history.branch}`
    }
  ];
  return {
    ...step,
    action: {
      ...step.action,
      descriptor: confirmedDescriptor(suggested)
    },
    patchHistory
  };
}

/** L7-003 / L7-049: apply the confirmed suggestion as hashed; do not rewrite type. */
export function confirmedDescriptor(suggested: ReplayDescriptor): ReplayDescriptor {
  return cloneDescriptor(suggested);
}

function typeMismatchForApply(
  scenario: Scenario,
  patches: ReadonlyArray<{ stepIndex: number; suggested: ReplayDescriptor }>
): AssistedApplyRefusal | undefined {
  for (const patch of patches) {
    const step = scenario.steps.find((entry) => entry.index === patch.stepIndex);
    if (step === undefined || patch.suggested.type !== step.action.type) {
      return {
        ok: false,
        code: 'type-mismatch',
        reason: 'suggested descriptor type does not match the scenario step'
      };
    }
  }
  return undefined;
}

async function gitOkOrThrow(git: GitExec, cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(args, cwd);
  if (result.code !== 0) {
    throw new GitApplyError(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

/** L7-066 / L7-067: restore HEAD, then best-effort delete a patch branch we created. */
async function restoreStartingBranch(
  git: GitExec,
  cwd: string,
  startingBranch: string,
  danglingPatchBranch?: string
): Promise<string | undefined> {
  let revertError: string | undefined;
  try {
    const restored = await git(['checkout', '-f', startingBranch], cwd);
    if (restored.code !== 0) {
      revertError = restored.stderr.trim() || `git checkout -f ${startingBranch} failed`;
    }
  } catch (error) {
    revertError = error instanceof Error ? error.message : String(error);
  }
  if (revertError !== undefined) {
    console.error(`[spyglass] failed to restore ${startingBranch}: ${revertError}`);
  }
  if (danglingPatchBranch !== undefined && danglingPatchBranch.length > 0) {
    try {
      const deleted = await git(['branch', '-D', danglingPatchBranch], cwd);
      if (deleted.code !== 0) {
        console.error(
          `[spyglass] failed to delete dangling ${danglingPatchBranch}: ${deleted.stderr.trim()}`
        );
      }
    } catch (error) {
      console.error(
        `[spyglass] failed to delete dangling ${danglingPatchBranch}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return revertError;
}

/** P12a: local commit stays; PR prep failure is ok:false and does not increment health. */
function prPrepFailed(input: {
  branch: string;
  commit: string;
  health: ScenarioHealth;
  reason: string;
}): AssistedApplyRefusal {
  return {
    ok: false,
    code: 'pr-prep-failed',
    reason: input.reason,
    branch: input.branch,
    commit: input.commit,
    health: input.health
  };
}

function refusalWithRestore(
  refusal: AssistedApplyRefusal,
  revertError: string | undefined,
  startingBranch: string
): AssistedApplyRefusal {
  if (revertError === undefined) {
    return refusal;
  }
  return {
    ...refusal,
    reason: `${refusal.reason}; also failed to restore ${startingBranch}: ${revertError}`
  };
}

async function checkoutOrGitError(
  git: GitExec,
  cwd: string,
  startingBranch: string,
  args: readonly string[]
): Promise<AssistedApplyRefusal | undefined> {
  try {
    await gitOkOrThrow(git, cwd, args);
    return undefined;
  } catch (error) {
    const revertError = await restoreStartingBranch(git, cwd, startingBranch);
    return refusalWithRestore(
      {
        ok: false,
        code: 'git-error',
        reason: error instanceof Error ? error.message : String(error)
      },
      revertError,
      startingBranch
    );
  }
}

/** L7-094: after local recreate, origin may already have this spyglass/patch-* name. */
function isNonFastForwardPush(stderr: string): boolean {
  return /non-fast-forward|\[rejected\]|fetch first/iu.test(stderr);
}

async function pushPatchBranch(git: GitExec, repoRoot: string, branch: string): Promise<boolean> {
  const pushed = await git(['push', '-u', 'origin', branch], repoRoot);
  if (pushed.code === 0) {
    return true;
  }
  if (!isNonFastForwardPush(pushed.stderr)) {
    return false;
  }
  const deleted = await git(['push', 'origin', '--delete', branch], repoRoot);
  if (deleted.code !== 0) {
    return false;
  }
  const retried = await git(['push', '-u', 'origin', branch], repoRoot);
  return retried.code === 0;
}

const GH_PR_CREATE_TIMEOUT_MS = 120_000;

async function tryGhPrCreate(input: {
  repo: string;
  branch: string;
  defaultBranch: string;
  title: string;
  body: string;
}): Promise<{ ok: true; url?: string } | { ok: false }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const result = await execFileAsync(
      'gh',
      [
        'pr',
        'create',
        '--draft',
        '--base',
        input.defaultBranch,
        '--head',
        input.branch,
        '--title',
        input.title,
        '--body',
        input.body
      ],
      {
        cwd: input.repo,
        encoding: 'utf8',
        timeout: GH_PR_CREATE_TIMEOUT_MS,
        killSignal: 'SIGKILL'
      }
    );
    const url = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('http'));
    if (url !== undefined && url.length > 0) {
      return { ok: true, url };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function loadScenarioJson(path: string): Promise<Scenario> {
  return asScenario(JSON.parse(await readFile(path, 'utf8')) as unknown);
}
