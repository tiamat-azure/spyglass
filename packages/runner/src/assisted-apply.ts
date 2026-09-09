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
  gitOk,
  isDefaultBranchName,
  isGitApplyError,
  isUnresolvedDefaultBranchError,
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
    | 'pr-prep-failed'
    | 'open-pr'
    | 'unresolved-default'
    | 'restore-failed';
  /** P12a / P14a: set when the local patch commit succeeded but PR prep / remote recreate failed. */
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

/** P14a: true when an open PR already uses this spyglass/patch-* head. */
export type HasOpenPr = (input: { repo: string; branch: string }) => Promise<boolean>;

/** After a successful push: default is `gh pr create --draft`. Tests stub this. */
export type CreatePr = (input: {
  repo: string;
  branch: string;
  defaultBranch: string;
  title: string;
  body: string;
}) => Promise<{ ok: true; url?: string } | { ok: false }>;

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
  hasOpenPr?: HasOpenPr;
  createPr?: CreatePr;
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
  const scenarioRel = relative(resolvedScenario.repoReal, scenarioPath).split(sep).join('/');

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
  const hash = patchSetHash(toApply);
  const branch = patchBranchName(input.suggested.sessionId, hash);

  let defaultBranch: string;
  let starting: StartingHead;
  let leftoverExists: boolean;
  try {
    // L7-144: pre-mutation probes must not throw out of applyAssistedPatches.
    if (await isWorktreeDirty(git, repoRoot)) {
      return { ok: false, reason: 'F-64: refusing dirty worktree', code: 'dirty-worktree' };
    }
    defaultBranch = await detectDefaultBranch(git, repoRoot);
    starting = {
      name: await currentBranch(git, repoRoot),
      sha: (await gitOk(git, repoRoot, ['rev-parse', 'HEAD'])).trim()
    };
    leftoverExists = await localBranchExists(git, repoRoot, branch);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isUnresolvedDefaultBranchError(error)) {
      return { ok: false, reason, code: 'unresolved-default' };
    }
    return {
      ok: false,
      reason,
      code: isGitApplyError(error) ? 'git-error' : 'internal-error'
    };
  }

  // L7-084 / P12a: a prior ok:false / pr-prep-failed attempt leaves spyglass/patch-* around.
  // Reuse it and resume PR prep instead of failing checkout -b.
  let skipMutate = false;
  let reloadScenarioFromDefault = false;
  if (leftoverExists) {
    const ontoPatch = await checkoutOrGitError(
      git,
      repoRoot,
      starting,
      ['checkout', branch],
      [scenarioRel]
    );
    if (ontoPatch !== undefined) {
      return ontoPatch;
    }
    try {
      const onPatch = await loadScenarioJson(scenarioPath);
      if (
        scenarioHasAppliedPatches(onPatch, toApply) &&
        (await leftoverPatchOnlyExpectedScenario(
          git,
          repoRoot,
          defaultBranch,
          scenarioRel,
          onPatch,
          toApply
        ))
      ) {
        skipMutate = true;
      } else {
        // L7-213: re-check dirty and never `checkout -f` — force would discard
        // tracked edits made after the initial dirty probe.
        if (await isWorktreeDirty(git, repoRoot)) {
          const revertError = await restoreStartingBranch(git, repoRoot, starting, undefined, [
            scenarioRel
          ]);
          return refusalWithRestore(
            { ok: false, reason: 'F-64: refusing dirty worktree', code: 'dirty-worktree' },
            revertError,
            starting
          );
        }
        const ontoDefault = await checkoutOrGitError(
          git,
          repoRoot,
          starting,
          ['checkout', defaultBranch],
          [scenarioRel]
        );
        if (ontoDefault !== undefined) {
          return ontoDefault;
        }
        const deleted = await git(['branch', '-D', branch], repoRoot);
        if (deleted.code !== 0) {
          const revertError = await restoreStartingBranch(git, repoRoot, starting, undefined, [
            scenarioRel
          ]);
          return refusalWithRestore(
            {
              ok: false,
              code: 'git-error',
              reason: deleted.stderr.trim() || `git branch -D ${branch} failed`
            },
            revertError,
            starting
          );
        }
        // L7-134: disk is defaultBranch now; do not keep input.scenario from the leftover patch.
        reloadScenarioFromDefault = true;
      }
    } catch (error) {
      const revertError = await restoreStartingBranch(git, repoRoot, starting, undefined, [
        scenarioRel
      ]);
      return refusalWithRestore(
        {
          ok: false,
          code: 'internal-error',
          reason: error instanceof Error ? error.message : String(error)
        },
        revertError,
        starting
      );
    }
  }

  let scenario = input.scenario;
  let commit: string;
  if (skipMutate) {
    try {
      commit = (await gitOkOrThrow(git, repoRoot, ['rev-parse', 'HEAD'])).trim();
    } catch (error) {
      const revertError = await restoreStartingBranch(git, repoRoot, starting, undefined, [
        scenarioRel
      ]);
      return refusalWithRestore(
        {
          ok: false,
          code: isGitApplyError(error) ? 'git-error' : 'internal-error',
          reason: error instanceof Error ? error.message : String(error)
        },
        revertError,
        starting
      );
    }
  } else {
    if (starting.name !== defaultBranch || reloadScenarioFromDefault) {
      const headNow = await currentBranch(git, repoRoot);
      if (headNow !== defaultBranch) {
        const switched = await checkoutOrGitError(
          git,
          repoRoot,
          starting,
          ['checkout', defaultBranch],
          [scenarioRel]
        );
        if (switched !== undefined) {
          return switched;
        }
      }
      try {
        scenario = await loadScenarioJson(scenarioPath);
      } catch (error) {
        const revertError = await restoreStartingBranch(git, repoRoot, starting, undefined, [
          scenarioRel
        ]);
        return refusalWithRestore(
          {
            ok: false,
            code: 'internal-error',
            reason: error instanceof Error ? error.message : String(error)
          },
          revertError,
          starting
        );
      }
    }
    const created = await checkoutOrGitError(
      git,
      repoRoot,
      starting,
      ['checkout', '-b', branch],
      [scenarioRel]
    );
    if (created !== undefined) {
      return created;
    }
    const onBranch = await currentBranch(git, repoRoot);
    if (isDefaultBranchName(onBranch, defaultBranch)) {
      const revertError = await restoreStartingBranch(git, repoRoot, starting, branch, [
        scenarioRel
      ]);
      return refusalWithRestore(
        { ok: false, reason: 'F-64: never commit the default branch', code: 'default-branch' },
        revertError,
        starting
      );
    }

    const typeMismatch = typeMismatchForApply(scenario, toApply);
    if (typeMismatch !== undefined) {
      const revertError = await restoreStartingBranch(git, repoRoot, starting, branch, [
        scenarioRel
      ]);
      return refusalWithRestore(typeMismatch, revertError, starting);
    }

    try {
      // L7-210: re-check immediately before write/commit so concurrent edits
      // during checkout cannot be overwritten or committed unnoticed.
      if (await isWorktreeDirty(git, repoRoot)) {
        const revertError = await restoreStartingBranch(git, repoRoot, starting, branch, []);
        return refusalWithRestore(
          { ok: false, reason: 'F-64: refusing dirty worktree', code: 'dirty-worktree' },
          revertError,
          starting
        );
      }
      const patched = applyDescriptorsToScenario(scenario, toApply, {
        runId: input.suggested.runId,
        date: (input.now ?? new Date()).toISOString(),
        branch
      });
      await writeFile(scenarioPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');

      const rel = scenarioRel;
      await gitOkOrThrow(git, repoRoot, ['add', '--', rel]);
      const message = `fix(spyglass): assisted action.descriptor patch for ${input.suggested.sessionId}\n\nHuman review required (F-64). CI green is not merge.`;
      await gitOkOrThrow(git, repoRoot, ['commit', '-m', message]);
      commit = (await gitOkOrThrow(git, repoRoot, ['rev-parse', 'HEAD'])).trim();
    } catch (error) {
      const revertError = await restoreStartingBranch(git, repoRoot, starting, branch, [
        scenarioRel
      ]);
      const reason = error instanceof Error ? error.message : String(error);
      return refusalWithRestore(
        {
          ok: false,
          reason,
          code: isGitApplyError(error) ? 'git-error' : 'internal-error'
        },
        revertError,
        starting
      );
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
      return await afterLocalCommitRefusal({
        git,
        repoRoot,
        starting,
        revertPaths: [scenarioRel],
        branch,
        commit,
        health: input.health,
        code: 'pr-prep-failed',
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    try {
      const pushed = await pushPatchBranch(
        git,
        repoRoot,
        branch,
        input.hasOpenPr ?? defaultHasOpenPr
      );
      if (!pushed.ok) {
        return await afterLocalCommitRefusal({
          git,
          repoRoot,
          starting,
          revertPaths: [scenarioRel],
          branch,
          commit,
          health: input.health,
          code: pushed.code,
          reason: pushed.reason
        });
      }
      const gh = await (input.createPr ?? tryGhPrCreate)({
        repo: repoRoot,
        branch,
        defaultBranch,
        title,
        body
      });
      if (!gh.ok) {
        return await afterLocalCommitRefusal({
          git,
          repoRoot,
          starting,
          revertPaths: [scenarioRel],
          branch,
          commit,
          health: input.health,
          code: 'pr-prep-failed',
          reason: 'gh pr create failed'
        });
      }
      if (gh.url !== undefined && gh.url.length > 0) {
        prUrl = gh.url;
      }
    } catch (error) {
      return await afterLocalCommitRefusal({
        git,
        repoRoot,
        starting,
        revertPaths: [scenarioRel],
        branch,
        commit,
        health: input.health,
        code: 'pr-prep-failed',
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const health = incrementAppliedPatches(
    input.health,
    toApply.map((item) => item.stepIndex),
    policy
  );

  // B16a / L7-129: after success, return to the pre-apply starting ref. Do not
  // use currentBranch() here — HEAD is the patch branch. Leave spyglass/patch-*
  // in place for human review (do not pass it as danglingPatchBranch).
  const restoreError = await restoreStartingBranch(git, repoRoot, starting, undefined, [
    scenarioRel
  ]);
  if (restoreError !== undefined) {
    return {
      ok: false,
      code: 'restore-failed',
      reason: restoreError,
      branch,
      commit,
      health: input.health
    };
  }

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

/** L7-119: named branch, or the SHA when `rev-parse --abbrev-ref` is `HEAD`. */
type StartingHead = {
  name: string;
  sha: string;
};

function startingCheckoutRef(head: StartingHead): string {
  return head.name === 'HEAD' ? head.sha : head.name;
}

/** L7-066 / L7-067 / L7-167: restore HEAD without `checkout -f`. */
async function restoreStartingBranch(
  git: GitExec,
  cwd: string,
  starting: StartingHead,
  danglingPatchBranch?: string,
  revertPaths: readonly string[] = []
): Promise<string | undefined> {
  const target = startingCheckoutRef(starting);
  let revertError: string | undefined;
  try {
    const status = await git(['status', '--porcelain'], cwd);
    if (status.code !== 0) {
      revertError = status.stderr.trim() || 'git status failed';
    } else {
      const trackedDirty = trackedDirtyPaths(status.stdout);
      const allowed = new Set(revertPaths);
      const unexpected = trackedDirty.filter((path) => !allowed.has(path));
      if (unexpected.length > 0) {
        revertError = `refusing to discard uncommitted changes: ${unexpected.join(', ')}`;
      } else {
        for (const file of revertPaths) {
          const unstage = await git(['reset', 'HEAD', '--', file], cwd);
          if (unstage.code !== 0) {
            revertError = unstage.stderr.trim() || `git reset HEAD -- ${file} failed`;
            break;
          }
        }
        if (revertError === undefined) {
          for (const file of trackedDirty) {
            const reset = await git(['checkout', '--', file], cwd);
            if (reset.code !== 0) {
              revertError = reset.stderr.trim() || `git checkout -- ${file} failed`;
              break;
            }
          }
        }
        if (revertError === undefined) {
          const restored = await git(['checkout', target], cwd);
          if (restored.code !== 0) {
            revertError = restored.stderr.trim() || `git checkout ${target} failed`;
          }
        }
      }
    }
  } catch (error) {
    revertError = error instanceof Error ? error.message : String(error);
  }
  if (revertError !== undefined) {
    console.error(`[spyglass] failed to restore ${target}: ${revertError}`);
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

function trackedDirtyPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) {
      continue;
    }
    const xy = line.slice(0, 2);
    if (xy === '??' || xy === '!!') {
      continue;
    }
    const rest = line.slice(3).trim();
    const renamed = rest.split(' -> ');
    const raw = renamed[renamed.length - 1] ?? '';
    const path = raw.replace(/^"(.*)"$/u, '$1').replaceAll('\\', '/');
    if (path.length > 0) {
      paths.push(path);
    }
  }
  return paths;
}

/** L7-168 / L7-171: leftover may be reused only if it forks default, only changes scenario.json, and that file differs solely by action.descriptor (plus apply patchHistory). */
async function leftoverPatchOnlyExpectedScenario(
  git: GitExec,
  cwd: string,
  defaultBranch: string,
  scenarioRel: string,
  leftover: Scenario,
  patches: ReadonlyArray<{ stepIndex: number; hash: string }>
): Promise<boolean> {
  const ancestor = await git(['merge-base', '--is-ancestor', defaultBranch, 'HEAD'], cwd);
  if (ancestor.code !== 0) {
    return false;
  }
  const diff = await git(['diff', '--name-only', `${defaultBranch}...HEAD`], cwd);
  if (diff.code !== 0) {
    return false;
  }
  const files = diff.stdout
    .split('\n')
    .map((line) => line.trim().replaceAll('\\', '/'))
    .filter((line) => line.length > 0);
  if (files.length === 0 || files.some((file) => file !== scenarioRel)) {
    return false;
  }
  const shown = await git(['show', `${defaultBranch}:${scenarioRel}`], cwd);
  if (shown.code !== 0) {
    return false;
  }
  let fromDefault: Scenario;
  try {
    fromDefault = asScenario(JSON.parse(shown.stdout) as unknown);
  } catch {
    return false;
  }
  return leftoverMatchesDescriptorOnlyApply(fromDefault, leftover, patches);
}

function leftoverMatchesDescriptorOnlyApply(
  fromDefault: Scenario,
  leftover: Scenario,
  patches: ReadonlyArray<{ stepIndex: number }>
): boolean {
  const patched = new Set(patches.map((entry) => entry.stepIndex));
  const expected = structuredClone(fromDefault) as Scenario;
  for (const step of leftover.steps) {
    const base = expected.steps.find((entry) => entry.index === step.index);
    if (base === undefined) {
      return false;
    }
    if (!patched.has(step.index)) {
      continue;
    }
    base.action.descriptor = step.action.descriptor;
    if (step.patchHistory !== undefined) {
      base.patchHistory = step.patchHistory;
    } else {
      delete base.patchHistory;
    }
  }
  return JSON.stringify(expected) === JSON.stringify(leftover);
}

/** P12a / P14a / L7-183: local commit stays on the patch branch; restore starting ref. */
async function afterLocalCommitRefusal(input: {
  git: GitExec;
  repoRoot: string;
  starting: StartingHead;
  revertPaths: readonly string[];
  branch: string;
  commit: string;
  health: ScenarioHealth;
  code: 'pr-prep-failed' | 'open-pr';
  reason: string;
}): Promise<AssistedApplyRefusal> {
  const revertError = await restoreStartingBranch(
    input.git,
    input.repoRoot,
    input.starting,
    undefined,
    input.revertPaths
  );
  if (revertError !== undefined) {
    return {
      ok: false,
      code: 'restore-failed',
      reason: revertError,
      branch: input.branch,
      commit: input.commit,
      health: input.health
    };
  }
  return {
    ok: false,
    code: input.code,
    reason: input.reason,
    branch: input.branch,
    commit: input.commit,
    health: input.health
  };
}

function refusalWithRestore(
  refusal: AssistedApplyRefusal,
  revertError: string | undefined,
  starting: StartingHead
): AssistedApplyRefusal {
  if (revertError === undefined) {
    return refusal;
  }
  const target = startingCheckoutRef(starting);
  return {
    ...refusal,
    reason: `${refusal.reason}; also failed to restore ${target}: ${revertError}`
  };
}

async function checkoutOrGitError(
  git: GitExec,
  cwd: string,
  starting: StartingHead,
  args: readonly string[],
  revertPaths: readonly string[] = []
): Promise<AssistedApplyRefusal | undefined> {
  try {
    await gitOkOrThrow(git, cwd, args);
    return undefined;
  } catch (error) {
    const revertError = await restoreStartingBranch(git, cwd, starting, undefined, revertPaths);
    return refusalWithRestore(
      {
        ok: false,
        code: 'git-error',
        reason: error instanceof Error ? error.message : String(error)
      },
      revertError,
      starting
    );
  }
}

/**
 * L7-094 / L7-202: after local recreate, origin may already have this
 * spyglass/patch-* name. Only real non-fast-forward / tip-behind rejections
 * take the delete-and-repush path — not protected-branch, pre-receive, or
 * shallow `[rejected]` lines.
 */
export function isNonFastForwardPush(stderr: string): boolean {
  if (/non-fast-forward/iu.test(stderr)) {
    return true;
  }
  if (/\[rejected\][^\n]*\(fetch first\)/iu.test(stderr)) {
    return true;
  }
  return /tip of your current branch is behind/iu.test(stderr);
}

const GH_PR_CREATE_TIMEOUT_MS = 120_000;

function ghExecEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
}

function gitFailureReason(stderr: string, args: readonly string[]): string {
  const detail = stderr.trim();
  return detail.length > 0 ? detail : `git ${args.join(' ')} failed`;
}

async function remoteDeleteBlockedByOpenPr(
  hasOpenPr: HasOpenPr,
  input: { repo: string; branch: string }
): Promise<{ ok: true } | { ok: false; code: 'pr-prep-failed' | 'open-pr'; reason: string }> {
  let openPr: boolean;
  try {
    openPr = await hasOpenPr(input);
  } catch (error) {
    return {
      ok: false,
      code: 'pr-prep-failed',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  if (openPr) {
    return {
      ok: false,
      code: 'open-pr',
      reason: `open PR exists for ${input.branch}; remote left unchanged`
    };
  }
  return { ok: true };
}

async function pushPatchBranch(
  git: GitExec,
  repoRoot: string,
  branch: string,
  hasOpenPr: HasOpenPr
): Promise<{ ok: true } | { ok: false; code: 'pr-prep-failed' | 'open-pr'; reason: string }> {
  const pushArgs = ['push', '-u', 'origin', branch] as const;
  const pushed = await git(pushArgs, repoRoot);
  if (pushed.code === 0) {
    return { ok: true };
  }
  if (!isNonFastForwardPush(pushed.stderr)) {
    return { ok: false, code: 'pr-prep-failed', reason: gitFailureReason(pushed.stderr, pushArgs) };
  }
  const probe = { repo: repoRoot, branch };
  const blocked = await remoteDeleteBlockedByOpenPr(hasOpenPr, probe);
  if (!blocked.ok) {
    return blocked;
  }
  // L7-227: re-check immediately before origin --delete (TOCTOU vs the probe above).
  const blockedAgain = await remoteDeleteBlockedByOpenPr(hasOpenPr, probe);
  if (!blockedAgain.ok) {
    return blockedAgain;
  }
  const deletedArgs = ['push', 'origin', '--delete', branch] as const;
  const deleted = await git(deletedArgs, repoRoot);
  if (deleted.code !== 0) {
    return {
      ok: false,
      code: 'pr-prep-failed',
      reason: gitFailureReason(deleted.stderr, deletedArgs)
    };
  }
  const retried = await git(pushArgs, repoRoot);
  if (retried.code === 0) {
    return { ok: true };
  }
  return { ok: false, code: 'pr-prep-failed', reason: gitFailureReason(retried.stderr, pushArgs) };
}

/** P14a / L7-130: non-array `gh pr list --json` is unknown → treat as open. */
export function openPrListMeansOpen(parsed: unknown): boolean {
  if (!Array.isArray(parsed)) {
    return true;
  }
  return parsed.length > 0;
}

/** P14a fail-closed: if `gh` cannot prove there is no open PR, do not delete remote. */
export async function defaultHasOpenPr(input: { repo: string; branch: string }): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const result = await execFileAsync(
      'gh',
      ['pr', 'list', '--head', input.branch, '--state', 'open', '--json', 'number'],
      {
        cwd: input.repo,
        encoding: 'utf8',
        timeout: GH_PR_CREATE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: ghExecEnv()
      }
    );
    const parsed = JSON.parse(result.stdout) as unknown;
    return openPrListMeansOpen(parsed);
  } catch (error) {
    logGhError('gh pr list', error);
    return true;
  }
}

export async function tryGhPrCreate(input: {
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
        killSignal: 'SIGKILL',
        env: ghExecEnv()
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
  } catch (error) {
    logGhError('gh pr create', error);
    return { ok: false };
  }
}

function logGhError(op: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`spyglass: ${op} failed: ${message}\n`);
}

export async function loadScenarioJson(path: string): Promise<Scenario> {
  return asScenario(JSON.parse(await readFile(path, 'utf8')) as unknown);
}
