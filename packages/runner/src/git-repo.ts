import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Matches `tryGhPrCreate` so hung `git push` / credential prompts fail closed. */
export const GIT_EXEC_TIMEOUT_MS = 120_000;
/** L7-223: above Node's ~1MB and the former 2MB cap so status/diff/log on large repos is not truncated. */
export const GIT_EXEC_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export type GitExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  /** L7-235: true when the child was SIGKILL'd / timed out, not a normal git exit. */
  timedOut?: boolean;
  signal?: string;
};

/** GNU `timeout(1)` convention; not a normal git exit code 1. */
export const GIT_TIMEOUT_EXIT_CODE = 124;
/** Spawn ENOENT/EACCES/ENOTDIR — not git `--quiet` missing (exit 1). */
export const GIT_SPAWN_FAILURE_EXIT_CODE = 127;

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
  constructor(
    message = 'unable to detect default branch (need origin/HEAD or local/remote main/master)'
  ) {
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
  return execGitTimed(args, cwd, GIT_EXEC_TIMEOUT_MS);
}

/** Same spawn options as `defaultGitExec`, with a caller-chosen timeout (L7-093 / L7-160). */
export async function execGitTimed(
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<GitExecResult> {
  try {
    const result = await execFileAsync('git', [...args], gitChildExecOptions(cwd, timeoutMs));
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    return gitExecResultFromFailure(error);
  }
}

/** L7-235: SIGKILL / timeout is not ordinary git exit 1. */
export function gitExecResultFromFailure(error: unknown): GitExecResult {
  const err = error as {
    stdout?: string;
    stderr?: string;
    code?: unknown;
    killed?: boolean;
    signal?: string;
    message?: string;
  };
  const signal = typeof err.signal === 'string' ? err.signal : undefined;
  const timedOut =
    err.killed === true ||
    signal === 'SIGKILL' ||
    (typeof err.code === 'string' && /TIMEOUT|ETIMEDOUT/iu.test(err.code));
  let numericCode = 1;
  if (typeof err.code === 'number') {
    numericCode = err.code;
  } else if (timedOut) {
    numericCode = GIT_TIMEOUT_EXIT_CODE;
  } else if (typeof err.code === 'string') {
    // L7-286: ENOENT/EACCES/ENOTDIR must not look like `--quiet` exit 1.
    numericCode = GIT_SPAWN_FAILURE_EXIT_CODE;
  }
  return {
    stdout: err.stdout ?? '',
    stderr: err.stderr ?? err.message ?? String(error),
    code: numericCode,
    ...(timedOut ? { timedOut: true } : {}),
    ...(signal !== undefined ? { signal } : {})
  };
}

export function gitChildExecOptions(
  cwd: string,
  timeoutMs: number
): {
  cwd: string;
  encoding: 'utf8';
  maxBuffer: number;
  timeout: number;
  killSignal: NodeJS.Signals;
  env: NodeJS.ProcessEnv;
} {
  return {
    cwd,
    encoding: 'utf8',
    maxBuffer: GIT_EXEC_MAX_BUFFER_BYTES,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  };
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
 * G28b / F-64: PR `--base` is `origin/HEAD` or local/remote `main`/`master`
 * only. Never the currently checked-out branch. L7-126: never literal HEAD.
 */
export async function detectDefaultBranch(exec: GitExec, cwd: string): Promise<string> {
  const originHead = await exec(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd);
  if (isGitProbeHardFailure(originHead)) {
    throw new GitApplyError(
      originHead.stderr.trim() || 'git symbolic-ref refs/remotes/origin/HEAD failed'
    );
  }
  if (originHead.code === 0) {
    const ref = originHead.stdout.trim();
    const short = ref.replace(/^refs\/remotes\/origin\//u, '');
    if (isUsableDefaultBranch(short)) {
      return short;
    }
    throw new GitApplyError('git symbolic-ref origin/HEAD returned an unusable name');
  }
  for (const name of DEFAULT_BRANCH_NAMES) {
    const local = await exec(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd);
    if (isGitProbeHardFailure(local)) {
      throw new GitApplyError(local.stderr.trim() || `git rev-parse refs/heads/${name} failed`);
    }
    if (local.code === 0) {
      return name;
    }
  }
  for (const name of DEFAULT_BRANCH_NAMES) {
    const remote = await exec(
      ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`],
      cwd
    );
    if (isGitProbeHardFailure(remote)) {
      throw new GitApplyError(
        remote.stderr.trim() || `git rev-parse refs/remotes/origin/${name} failed`
      );
    }
    if (remote.code === 0) {
      return name;
    }
  }
  throw new UnresolvedDefaultBranchError();
}

/** `--quiet` missing is exit 1. Timeout / fatal / other non-zero must not continue. */
function isGitProbeHardFailure(result: GitExecResult): boolean {
  if (result.timedOut === true) {
    return true;
  }
  return result.code !== 0 && result.code !== 1;
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
