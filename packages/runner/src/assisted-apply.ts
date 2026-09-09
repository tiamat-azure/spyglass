import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  RefinedStep,
  ReplayDescriptor,
  Scenario,
  ScenarioHealth,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { descriptorHash } from './descriptor-hash.ts';
import {
  currentBranch,
  DEFAULT_BRANCH_NAMES,
  defaultGitExec,
  detectDefaultBranch,
  type GitExec,
  isDefaultBranchName,
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
    | 'git-error';
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

export function isInsideRepo(repoRoot: string, filePath: string): boolean {
  const root = resolve(repoRoot);
  const target = resolve(filePath);
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
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
  const scenarioPath = resolve(input.scenarioPath);
  if (!isInsideRepo(repoRoot, scenarioPath)) {
    return {
      ok: false,
      reason: 'F-64: scenario.json must live inside the target --repo',
      code: 'scenario-outside-repo'
    };
  }

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
    if (candidate.consecutiveRuns < policy.confirmRuns) {
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
  const hash = toApply[0]?.hash ?? 'patch';
  const branch = patchBranchName(input.suggested.sessionId, hash);

  if (startingBranch !== defaultBranch) {
    await gitOkOrThrow(git, repoRoot, ['checkout', defaultBranch]);
  }
  await gitOkOrThrow(git, repoRoot, ['checkout', '-b', branch]);
  const onBranch = await currentBranch(git, repoRoot);
  if (
    isDefaultBranchName(onBranch, defaultBranch) ||
    DEFAULT_BRANCH_NAMES.includes(onBranch as 'main')
  ) {
    await git(['checkout', startingBranch], repoRoot).catch(() => undefined);
    return { ok: false, reason: 'F-64: never commit the default branch', code: 'default-branch' };
  }

  const patched = applyDescriptorsToScenario(input.scenario, toApply, {
    runId: input.suggested.runId,
    date: (input.now ?? new Date()).toISOString(),
    branch
  });
  await writeFile(scenarioPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');

  const rel = relative(repoRoot, scenarioPath).split(sep).join('/');
  await gitOkOrThrow(git, repoRoot, ['add', '--', rel]);
  const message = `fix(spyglass): assisted action.descriptor patch for ${input.suggested.sessionId}\n\nHuman review required (F-64). CI green is not merge.`;
  await gitOkOrThrow(git, repoRoot, ['commit', '-m', message]);
  const commit = (await gitOkOrThrow(git, repoRoot, ['rev-parse', 'HEAD'])).trim();

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
  let prPrepared = false;
  if (input.preparePr !== undefined) {
    const prepared = await input.preparePr({
      repo: repoRoot,
      branch,
      defaultBranch,
      title,
      body
    });
    prPrepared = true;
    if (prepared.url !== undefined && prepared.url.length > 0) {
      prUrl = prepared.url;
    }
  } else {
    const pushed = await git(['push', '-u', 'origin', branch], repoRoot);
    if (pushed.code === 0) {
      const gh = await tryGhPrCreate({ repo: repoRoot, branch, defaultBranch, title, body });
      if (gh.ok) {
        prPrepared = true;
        if (gh.url !== undefined && gh.url.length > 0) {
          prUrl = gh.url;
        }
      }
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
    prPrepared,
    merged: false,
    appliedStepIndexes: toApply.map((item) => item.stepIndex),
    health
  };
  if (prUrl !== undefined) {
    result.prUrl = prUrl;
  }
  return result;
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
      descriptor: confirmedDescriptor(suggested, step.action.type)
    },
    patchHistory
  };
}

/** L7-003: apply the confirmed suggestion only; do not keep stale optional fields. */
export function confirmedDescriptor(
  suggested: ReplayDescriptor,
  type: ReplayDescriptor['type']
): ReplayDescriptor {
  const next = cloneDescriptor(suggested);
  next.type = type;
  return next;
}

async function gitOkOrThrow(git: GitExec, cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(args, cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

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
      { cwd: input.repo, encoding: 'utf8' }
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
