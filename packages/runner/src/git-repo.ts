import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type GitExec = (args: readonly string[], cwd: string) => Promise<GitExecResult>;

export const DEFAULT_BRANCH_NAMES = ['main', 'master'] as const;

export async function defaultGitExec(args: readonly string[], cwd: string): Promise<GitExecResult> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 2_000_000
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
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

export async function isWorktreeDirty(exec: GitExec, cwd: string): Promise<boolean> {
  const result = await exec(['status', '--porcelain'], cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'git status failed');
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
    if (short.length > 0) {
      return short;
    }
  }
  for (const name of DEFAULT_BRANCH_NAMES) {
    const probe = await exec(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd);
    if (probe.code === 0) {
      return name;
    }
  }
  return (await currentBranch(exec, cwd)) || 'main';
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
