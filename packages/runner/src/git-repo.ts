import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Matches `tryGhPrCreate` so hung `git push` / credential prompts fail closed. */
export const GIT_EXEC_TIMEOUT_MS = 120_000;

export type GitExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type GitExec = (args: readonly string[], cwd: string) => Promise<GitExecResult>;

export const DEFAULT_BRANCH_NAMES = ['main', 'master'] as const;

/** Tagged so patch-lifecycle can classify without matching git stderr text (L7-075). */
export const GIT_APPLY_ERROR_TAG = 'spyglass.git-apply' as const;

/** L7-126: `detectDefaultBranch` must not yield literal HEAD or an empty name. */
export const UNRESOLVED_DEFAULT_TAG = 'spyglass.unresolved-default' as const;

export class GitApplyError extends Error {
  readonly tag: typeof GIT_APPLY_ERROR_TAG = GIT_APPLY_ERROR_TAG;
  constructor(message: string) {
    super(message);
    this.name = 'GitApplyError';
  }
}

export class UnresolvedDefaultBranchError extends GitApplyError {
  readonly unresolvedDefault: typeof UNRESOLVED_DEFAULT_TAG = UNRESOLVED_DEFAULT_TAG;
  constructor(message = 'unable to detect default branch (detached HEAD or unresolved)') {
    super(message);
    this.name = 'UnresolvedDefaultBranchError';
  }
}

export function isGitApplyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { tag?: unknown }).tag === GIT_APPLY_ERROR_TAG
  );
}

export function isUnresolvedDefaultBranchError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { unresolvedDefault?: unknown }).unresolvedDefault === UNRESOLVED_DEFAULT_TAG
  );
}

/** L7-126: never use detached `HEAD` or an empty name as `--base` / checkout target. */
export function isUsableDefaultBranch(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed !== 'HEAD';
}

export async function defaultGitExec(args: readonly string[], cwd: string): Promise<GitExecResult> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 2_000_000,
      timeout: GIT_EXEC_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? String(error),
      code: typeof err.code === 'number' ? err.code : 1
    };
  }
}

export async function gitOk(exec: GitExec, cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec(args, cwd);
  if (result.code !== 0) {
    throw new GitApplyError(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

export async function isWorktreeDirty(exec: GitExec, cwd: string): Promise<boolean> {
  const result = await exec(['status', '--porcelain'], cwd);
  if (result.code !== 0) {
    throw new GitApplyError(result.stderr.trim() || 'git status failed');
  }
  return result.stdout.trim().length > 0;
}

export async function currentBranch(exec: GitExec, cwd: string): Promise<string> {
  return (await gitOk(exec, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

/**
 * Prefer origin/HEAD, then local main/master. F-64: never commit this name.
 */
export async function detectDefaultBranch(exec: GitExec, cwd: string): Promise<string> {
  const originHead = await exec(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd);
  if (originHead.code === 0) {
    const ref = originHead.stdout.trim();
    const short = ref.replace(/^refs\/remotes\/origin\//u, '');
    if (isUsableDefaultBranch(short)) {
      return short;
    }
  }
  for (const name of DEFAULT_BRANCH_NAMES) {
    const probe = await exec(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd);
    if (probe.code === 0) {
      return name;
    }
  }
  const fallback = (await currentBranch(exec, cwd)).trim();
  if (!isUsableDefaultBranch(fallback)) {
    throw new UnresolvedDefaultBranchError();
  }
  return fallback;
}

export function isDefaultBranchName(branch: string, defaultBranch?: string): boolean {
  if (defaultBranch !== undefined && branch === defaultBranch) {
    return true;
  }
  return DEFAULT_BRANCH_NAMES.some((name) => name === branch);
}

export function patchBranchName(sessionId: string, hash: string): string {
  const slug = sessionId.replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 48);
  const short = hash.replace(/^sha256:/u, '').slice(0, 12);
  return `spyglass/patch-${slug}-${short}`;
}
