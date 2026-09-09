import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  RefinedStep,
  Scenario,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { validateHealth, validateUnknown } from '@spyglass/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAssistedPatches,
  assertAssistedApplyAllowed,
  confirmedDescriptor,
  defaultHasOpenPr,
  isNonFastForwardPush,
  openPrListMeansOpen,
  tryGhPrCreate
} from './assisted-apply.ts';
import {
  descriptorHash,
  patchSetHash,
  REPLAY_DESCRIPTOR_IDENTITY_KEYS
} from './descriptor-hash.ts';
import {
  defaultGitExec,
  detectDefaultBranch,
  GIT_EXEC_MAX_BUFFER_BYTES,
  GIT_EXEC_TIMEOUT_MS,
  GIT_TIMEOUT_EXIT_CODE,
  GitApplyError,
  type GitExec,
  gitChildExecOptions,
  gitExecResultFromFailure,
  isDefaultBranchName,
  isGitApplyError,
  isUnresolvedDefaultBranchError,
  patchBranchName
} from './git-repo.ts';
import {
  emptyHealth,
  healthStatus,
  incrementAppliedPatches,
  loadHealth,
  MAX_CANDIDATE_RUN_IDS,
  migrateHealthPatchCandidates,
  recordSuggestedPatches,
  resolveSessionDir,
  saveHealth
} from './health.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import { resolvePatchPolicy } from './patch-config.ts';
import { processSuggestedPatch, resolveScenarioPath } from './patch-lifecycle.ts';
import { type Recoverer, StaticRecoverer } from './recover.ts';
import { runScenario } from './run.ts';

const execFileAsync = promisify(execFile);
const tmpDirs: string[] = [];
const GIT_TEST_MS = process.platform === 'win32' ? 40_000 : 10_000;

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function rmTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const locked = code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EPERM';
      if (!locked || attempt === 3) {
        if (process.platform === 'win32' && locked) {
          return;
        }
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 100 * (attempt + 1));
      });
    }
  }
}

afterEach(async () => {
  const dirs = tmpDirs.splice(0);
  await Promise.all(dirs.map((dir) => rmTempDir(dir)));
});

function isSymlinkPrivilegeError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES';
}

function clickStep(index: number, selector: string): RefinedStep {
  return {
    index,
    intent: 'Je clique',
    action: {
      type: 'click',
      descriptor: { type: 'click', selector, selectorStrategy: 'css' }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
  };
}

function fillStep(index: number, selector: string, value: string, ref: string): RefinedStep {
  return {
    index,
    intent: 'Je saisis',
    action: {
      type: 'fill',
      parameterRef: ref,
      descriptor: { type: 'fill', selector, arguments: [value] }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
  };
}

function scenario(steps: RefinedStep[]): Scenario {
  return {
    schemaVersion: 1,
    sessionId: 'ses_lot7',
    startUrl: 'https://exemple.test/start',
    steps
  };
}

function patch(selector: string, runId = 'run_1'): SuggestedPatch {
  return {
    schemaVersion: 1,
    runId,
    sessionId: 'ses_lot7',
    applied: false,
    patches: [
      {
        stepIndex: 0,
        scope: 'action.descriptor',
        original: { type: 'click', selector: '#old' },
        suggested: { type: 'click', selector },
        diagnosis: 'selector drift',
        confidence: 0.9
      }
    ]
  };
}

async function gitShowJson<T>(dir: string, spec: string): Promise<T> {
  const raw = (await execFileAsync('git', ['show', spec], { cwd: dir })).stdout;
  return JSON.parse(raw) as T;
}

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'lot7@spyglass.test'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Lot7 Tests'], { cwd: dir });
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

describe('Lot 7 F-63 confirmation', () => {
  const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'false' });

  it('does not promote an isolated success', () => {
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.patchCandidates[0]?.descriptorHash).toBe(
      descriptorHash({ type: 'click', selector: '#new' })
    );
  });

  it('promotes after two consecutive identical descriptors', () => {
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(2);
    expect(health.patchCandidates[0]?.lastRunId).toBe('run_b');
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_a', 'run_b']);
  });

  it('resets consecutiveRuns when a run produces a different descriptor', () => {
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    health = recordSuggestedPatches(health, patch('#other', 'run_c'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.patchCandidates[0]?.descriptorHash).toBe(
      descriptorHash({ type: 'click', selector: '#other' })
    );
  });

  it('does not promote when the same runId is recorded twice (L7-001)', () => {
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_a']);
  });

  it('does not inflate consecutiveRuns when a prior runId reappears (L7-166)', () => {
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(2);
    expect(health.patchCandidates[0]?.lastRunId).toBe('run_b');
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_a', 'run_b']);
  });

  it('rejects a suggested patch whose sessionId does not match health (L7-185)', () => {
    const health = emptyHealth('ses_lot7');
    const other = patch('#new', 'run_a');
    other.sessionId = 'ses_other';
    expect(() => recordSuggestedPatches(health, other, policy)).toThrow(/sessionId/);
  });

  it('increments appliedPatches by unique step indexes (L7-136)', () => {
    const health = incrementAppliedPatches(emptyHealth('ses_lot7'), [0, 0, 1], policy);
    expect(health.appliedPatches).toBe(2);
  });

  it('caps stored runIds and consecutiveRuns to the retained window (L7-148 / L7-211)', () => {
    let health = emptyHealth('ses_lot7');
    const extra = 3;
    for (let i = 0; i < MAX_CANDIDATE_RUN_IDS + extra; i += 1) {
      health = recordSuggestedPatches(health, patch('#new', `run_${String(i)}`), policy);
    }
    const stored = health.patchCandidates[0]?.runIds ?? [];
    expect(stored).toHaveLength(MAX_CANDIDATE_RUN_IDS);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(MAX_CANDIDATE_RUN_IDS);
    expect(stored[0]).toBe(`run_${String(extra)}`);
    expect(stored[stored.length - 1]).toBe(`run_${String(MAX_CANDIDATE_RUN_IDS + extra - 1)}`);
    health = recordSuggestedPatches(health, patch('#new', 'run_0'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(MAX_CANDIDATE_RUN_IDS);
    expect(health.patchCandidates[0]?.runIds).toHaveLength(MAX_CANDIDATE_RUN_IDS);
    expect(health.patchCandidates[0]?.runIds).toContain('run_0');
    expect(health.patchCandidates[0]?.runIds).not.toContain('run_3');
  });

  it('invalidates a candidate on an intervening run with no patch for that step (L7-001)', () => {
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(
      health,
      { schemaVersion: 1, runId: 'run_b', sessionId: 'ses_lot7', applied: false, patches: [] },
      policy
    );
    expect(health.patchCandidates).toEqual([]);
    health = recordSuggestedPatches(health, patch('#new', 'run_c'), policy);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_c']);
  });
});

describe('Lot 7 F-65 fragility counters', () => {
  it('marks fragile at warn threshold and stale at stale threshold', () => {
    const policy = resolvePatchPolicy({});
    expect(healthStatus(0, policy)).toBe('healthy');
    expect(healthStatus(3, policy)).toBe('fragile');
    expect(healthStatus(5, policy)).toBe('stale');
    expect(healthStatus(4, { ...policy, warnThreshold: 3, staleThreshold: 5 })).toBe('fragile');
  });

  it('honours configurable thresholds', () => {
    const policy = resolvePatchPolicy({
      PATCH_WARN_THRESHOLD: '1',
      PATCH_STALE_THRESHOLD: '2'
    });
    expect(healthStatus(1, policy)).toBe('fragile');
    expect(healthStatus(2, policy)).toBe('stale');
  });

  it('rejects incomplete PATCH_* integer strings (L7-162)', () => {
    const fallback = resolvePatchPolicy({});
    expect(
      resolvePatchPolicy({
        PATCH_CONFIRM_RUNS: '1e9',
        PATCH_WARN_THRESHOLD: '2junk',
        PATCH_STALE_THRESHOLD: ' 3 '
      })
    ).toMatchObject({
      confirmRuns: fallback.confirmRuns,
      warnThreshold: fallback.warnThreshold,
      staleThreshold: 3
    });
  });
});

describe('Lot 7 F-62 / CA-14 illegal scopes', () => {
  it('refuses verification and structure patches even when assisted apply is on', () => {
    const env = {
      PATCH_ASSISTED_APPLY: 'true',
      PATCH_ALLOW_VERIFICATION: '1',
      PATCH_ALLOW_STRUCTURE: 'true',
      PATCH_ALLOW_ANY_SCOPE: '1'
    };
    const verification = {
      stepIndex: 0,
      scope: 'verification',
      original: { type: 'click', selector: '#a' },
      suggested: { type: 'click', selector: '#b' },
      diagnosis: 'weaken assert',
      confidence: 1
    } as unknown as SuggestedPatchEntry;
    const structure = {
      ...verification,
      scope: 'structure'
    } as unknown as SuggestedPatchEntry;
    expect(assertAssistedApplyAllowed(verification, env).ok).toBe(false);
    expect(assertAssistedApplyAllowed(structure, env).ok).toBe(false);
    const legal: SuggestedPatchEntry = {
      stepIndex: 0,
      scope: 'action.descriptor',
      original: { type: 'click', selector: '#a' },
      suggested: { type: 'click', selector: '#b' },
      diagnosis: 'ok',
      confidence: 1
    };
    expect(assertAssistedApplyAllowed(legal, env).ok).toBe(true);
  });

  it('never records verification or structure patches as health candidates', () => {
    const policy = resolvePatchPolicy({});
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(
      health,
      {
        schemaVersion: 1,
        runId: 'run_v',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'verification',
            original: { type: 'click', selector: '#a' },
            suggested: { type: 'click', selector: '#b' },
            diagnosis: 'weaken',
            confidence: 1
          } as unknown as SuggestedPatchEntry
        ]
      },
      policy
    );
    expect(health.patchCandidates).toEqual([]);
  });
});

describe('Lot 7 F-64 assisted git/PR path', { timeout: GIT_TEST_MS }, () => {
  it('does not apply when PATCH_ASSISTED_APPLY is false', async () => {
    const dir = await tempDir('spyglass-lot7-off-');
    const scenarioPath = join(dir, 'scenario.json');
    const scn = scenario([clickStep(0, '#old')]);
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'false' });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy: { ...policy, repo: dir }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('disabled');
    }
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
  });

  it('refuses a dirty worktree and never commits the default branch', async () => {
    const dir = await tempDir('spyglass-lot7-git-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    await writeFile(join(dir, 'dirty.txt'), 'nope\n', 'utf8');
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const dirty = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec
    });
    expect(dirty.ok).toBe(false);
    if (!dirty.ok) {
      expect(dirty.code).toBe('dirty-worktree');
    }
    const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    expect(branch.stdout.trim()).toBe('main');
  });

  it('re-checks a clean worktree immediately before write/commit (L7-210)', async () => {
    const src = await readFile(new URL('./assisted-apply.ts', import.meta.url), 'utf8');
    const writeIdx = src.indexOf('await writeFile(scenarioPath');
    const dirtyBeforeWrite = src.lastIndexOf('isWorktreeDirty', writeIdx);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(dirtyBeforeWrite).toBeGreaterThan(src.indexOf('isWorktreeDirty'));
    const dir = await tempDir('spyglass-lot7-l7210-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let porcelainCalls = 0;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'status' && args.includes('--porcelain')) {
        porcelainCalls += 1;
        if (porcelainCalls > 1) {
          return { stdout: '?? concurrent.txt\n', stderr: '', code: 0 };
        }
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('dirty-worktree');
    }
    expect(porcelainCalls).toBeGreaterThan(1);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
  });

  it('creates a dedicated branch and prepares a PR without merging after two matching runs', async () => {
    const dir = await tempDir('spyglass-lot7-pr-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    const mainSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const prepared: string[] = [];
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async (input) => {
        prepared.push(input.branch);
        expect(input.body).toMatch(/human review/i);
        return { url: 'https://github.com/example/target/pull/7' };
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.merged).toBe(false);
    expect(result.prPrepared).toBe(true);
    expect(result.prUrl).toBe('https://github.com/example/target/pull/7');
    expect(result.branch.startsWith('spyglass/patch-')).toBe(true);
    expect(prepared).toEqual([result.branch]);
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
    expect(head).not.toBe(result.branch);
    const patchRef = (
      await execFileAsync('git', ['show-ref', '--verify', `refs/heads/${result.branch}`], {
        cwd: dir
      })
    ).stdout.trim();
    expect(patchRef.length).toBeGreaterThan(0);
    const mainStill = (
      await execFileAsync('git', ['rev-parse', 'main'], { cwd: dir })
    ).stdout.trim();
    expect(mainStill).toBe(mainSha);
    const working = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(working.steps[0]?.action.descriptor.selector).toBe('#old');
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#new');
    expect(onPatch.steps[0]?.patchHistory?.[0]?.scope).toBe('action.descriptor');
    expect(result.health.appliedPatches).toBe(1);
  });

  it('checks out the pre-apply starting branch after success and leaves the patch branch (B16a)', async () => {
    const dir = await tempDir('spyglass-lot7-b16a-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    await execFileAsync('git', ['checkout', '-b', 'feature'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({ url: 'https://github.com/example/target/pull/16' })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.branch.startsWith('spyglass/patch-')).toBe(true);
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('feature');
    expect(head).not.toBe(result.branch);
    const patchRef = (
      await execFileAsync('git', ['show-ref', '--verify', `refs/heads/${result.branch}`], {
        cwd: dir
      })
    ).stdout.trim();
    expect(patchRef.length).toBeGreaterThan(0);
    const working = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(working.steps[0]?.action.descriptor.selector).toBe('#old');
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('returns restore-failed when checkout-back after success fails (L7-129)', async () => {
    const dir = await tempDir('spyglass-lot7-l7129-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'checkout' && args[1] !== '-b' && args[1] !== '--') {
        const head = (
          await defaultGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
        ).stdout.trim();
        if (head.startsWith('spyglass/patch-')) {
          return { stdout: '', stderr: 'fatal: cannot checkout starting branch', code: 128 };
        }
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({ url: 'https://github.com/example/target/pull/129' })
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('restore-failed');
    expect(result.reason).toMatch(/cannot checkout starting branch/);
    expect(result.health?.appliedPatches).toBe(0);
    expect(result.branch?.startsWith('spyglass/patch-')).toBe(true);
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(result.branch);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('returns ok:false pr-prep-failed when git push fails (L7-002 / P12a)', async () => {
    const dir = await tempDir('spyglass-lot7-pushfail-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push') {
        return { stdout: '', stderr: 'rejected', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/rejected/);
    expect(result.reason).not.toBe('git push failed');
    expect(result.health?.appliedPatches).toBe(0);
    expect(result.branch).toBeDefined();
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
    expect(head).not.toBe(result.branch);
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('replaces the descriptor with the confirmed suggestion only (L7-003)', async () => {
    const dir = await tempDir('spyglass-lot7-desc-');
    await initGitRepo(dir);
    const stale = clickStep(0, '#old');
    stale.action.descriptor.fallbackSelectors = ['#stale'];
    stale.action.descriptor.arguments = ['keep-me'];
    const scn = scenario([stale]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({ url: 'https://github.com/example/target/pull/8' })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    const descriptor = onPatch.steps[0]?.action.descriptor;
    expect(descriptor).toEqual({ type: 'click', selector: '#new' });
    expect(descriptor?.fallbackSelectors).toBeUndefined();
    expect(descriptor?.arguments).toBeUndefined();
    expect(descriptorHash(descriptor ?? { type: 'click', selector: '#new' })).toBe(
      descriptorHash({ type: 'click', selector: '#new' })
    );
  });

  it('refuses a scenario.json symlink that escapes --repo (L7-009)', async () => {
    const root = await tempDir('spyglass-lot7-symlink-');
    const repo = join(root, 'repo');
    const outside = join(root, 'outside');
    await mkdir(repo, { recursive: true });
    await mkdir(outside, { recursive: true });
    await initGitRepo(repo);
    const scn = scenario([clickStep(0, '#old')]);
    const outsideFile = join(outside, 'scenario.json');
    await writeFile(outsideFile, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    const scenarioPath = join(repo, 'scenario.json');
    try {
      await symlink(outsideFile, scenarioPath);
    } catch (error) {
      // L7-174: Windows without Developer Mode cannot create symlinks (EPERM).
      if (isSymlinkPrivilegeError(error)) {
        return;
      }
      throw error;
    }
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: repo });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('scenario-outside-repo');
    }
    const onDisk = JSON.parse(await readFile(outsideFile, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
  });

  it('refuses when the scenario parent cannot be realpath-ed (L7-056)', async () => {
    const dir = await tempDir('spyglass-lot7-missing-parent-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'nope', 'nested', 'scenario.json');
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('scenario-outside-repo');
    }
  });

  it('resolves a relative scenario path against the repo root (L7-036)', async () => {
    const dir = await tempDir('spyglass-lot7-relpath-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath: 'scenario.json',
      policy,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const patched = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(patched.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('returns ok:false pr-prep-failed without incrementing health when preparePr throws (P12a / H5b)', async () => {
    const dir = await tempDir('spyglass-lot7-prthrow-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => {
        throw new Error('gh down');
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/gh down/);
    expect(result.health?.appliedPatches).toBe(0);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
    expect(head).not.toBe(result.branch);
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('reuses an existing patch branch to resume PR preparation (L7-084)', async () => {
    const dir = await tempDir('spyglass-lot7-pr-retry-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const first = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => {
        throw new Error('gh down');
      }
    });
    expect(first.ok).toBe(false);
    if (first.ok) {
      return;
    }
    expect(first.code).toBe('pr-prep-failed');
    expect(first.health?.appliedPatches).toBe(0);
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    const second = await applyAssistedPatches({
      health: first.health ?? health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({ url: 'https://github.com/example/target/pull/9' })
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.prPrepared).toBe(true);
    expect(second.prUrl).toBe('https://github.com/example/target/pull/9');
    expect(second.branch).toBe(first.branch);
    expect(second.commit).toBe(first.commit);
    expect(second.health.appliedPatches).toBe(1);
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
    expect(head).not.toBe(second.branch);
  });

  it('times out hung git exec instead of waiting forever (L7-093 / L7-160)', async () => {
    expect(GIT_EXEC_TIMEOUT_MS).toBe(120_000);
    expect(GIT_EXEC_MAX_BUFFER_BYTES).toBeGreaterThan(2_000_000);
    expect(gitChildExecOptions(process.cwd(), 400).maxBuffer).toBe(GIT_EXEC_MAX_BUFFER_BYTES);
    const src = await readFile(new URL('./git-repo.ts', import.meta.url), 'utf8');
    expect(src).toContain('execGitTimed(args, cwd, GIT_EXEC_TIMEOUT_MS)');
    expect(src).toContain("killSignal: 'SIGKILL'");
    expect(src).toContain('maxBuffer: GIT_EXEC_MAX_BUFFER_BYTES');
    expect(src).not.toContain('maxBuffer: 2_000_000');
    expect(src).toContain('gitExecResultFromFailure');
    expect(src).toContain('GIT_TIMEOUT_EXIT_CODE');
    const started = Date.now();
    const hung = execFileAsync(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      gitChildExecOptions(process.cwd(), 400)
    );
    await expect(hung).rejects.toSatisfy((err: unknown) => {
      const failure = err as { killed?: boolean; signal?: string; message?: string };
      return (
        failure.killed === true ||
        failure.signal === 'SIGKILL' ||
        /SIGKILL|ETIMEDOUT|timeout/iu.test(failure.message ?? '')
      );
    });
    const elapsed = Date.now() - started;
    // L7-212: no wall-clock floor (flakes under CI load); prove kill + upper bound.
    expect(elapsed).toBeLessThan(15_000);
  });

  it('maps SIGKILL/timeout to timedOut, not ordinary exit 1 (L7-235)', () => {
    const killed = gitExecResultFromFailure({
      killed: true,
      signal: 'SIGKILL',
      stderr: 'killed'
    });
    expect(killed.timedOut).toBe(true);
    expect(killed.signal).toBe('SIGKILL');
    expect(killed.code).toBe(GIT_TIMEOUT_EXIT_CODE);
    expect(killed.code).not.toBe(1);
    const ordinary = gitExecResultFromFailure({ code: 1, stderr: 'error: failed to push' });
    expect(ordinary.timedOut).toBeUndefined();
    expect(ordinary.code).toBe(1);
  });

  it('retries push after a non-fast-forward when origin already has the branch (L7-094)', async () => {
    const dir = await tempDir('spyglass-lot7-nff-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let upstreamPushes = 0;
    let deletedRemote = false;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push' && args.includes('--delete')) {
        deletedRemote = true;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'push' && args.includes('-u')) {
        upstreamPushes += 1;
        if (upstreamPushes === 2) {
          return {
            stdout: '',
            stderr: '! [rejected] spyglass/patch (non-fast-forward)',
            code: 1
          };
        }
        return { stdout: '', stderr: '', code: 0 };
      }
      return await defaultGitExec(args, cwd);
    };
    const first = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => false,
      createPr: async () => ({ ok: false })
    });
    expect(first.ok).toBe(false);
    if (first.ok) {
      return;
    }
    expect(first.code).toBe('pr-prep-failed');
    const leftover = first.branch;
    expect(leftover).toBeDefined();
    if (leftover === undefined) {
      return;
    }
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    await execFileAsync('git', ['branch', '-D', leftover], { cwd: dir });
    const second = await applyAssistedPatches({
      health: first.health ?? health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => false,
      createPr: async () => ({ ok: false })
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.code).toBe('pr-prep-failed');
    expect(second.branch).toBe(first.branch);
    expect(deletedRemote).toBe(true);
    expect(upstreamPushes).toBe(3);
  });

  it('surfaces git push origin --delete stderr (L7-105)', async () => {
    const dir = await tempDir('spyglass-lot7-l7105-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push' && args.includes('--delete')) {
        return { stdout: '', stderr: 'remote ref refuse: cannot lock', code: 1 };
      }
      if (args[0] === 'push' && args.includes('-u')) {
        return {
          stdout: '',
          stderr: '! [rejected] spyglass/patch (non-fast-forward)',
          code: 1
        };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => false,
      createPr: async () => ({ ok: false })
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/remote ref refuse: cannot lock/);
    expect(result.reason).not.toBe('git push failed');
  });

  it('surfaces git push -u stderr on initial failure (L7-109)', async () => {
    const dir = await tempDir('spyglass-lot7-l7109-empty-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push') {
        return { stdout: '', stderr: '   ', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      createPr: async () => ({ ok: false })
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/git push -u origin .+ failed/);
    expect(result.reason).not.toBe('git push failed');
  });

  it('surfaces git push -u stderr on non-fast-forward retry failure (L7-109)', async () => {
    const dir = await tempDir('spyglass-lot7-l7109-retry-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let upstreamPushes = 0;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push' && args.includes('--delete')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'push' && args.includes('-u')) {
        upstreamPushes += 1;
        if (upstreamPushes === 1) {
          return {
            stdout: '',
            stderr: '! [rejected] spyglass/patch (non-fast-forward)',
            code: 1
          };
        }
        return { stdout: '', stderr: 'retry: remote hung up', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => false,
      createPr: async () => ({ ok: false })
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/retry: remote hung up/);
    expect(result.reason).not.toBe('git push failed');
  });

  it('does not treat protected-branch or shallow [rejected] as non-fast-forward (L7-202)', () => {
    expect(isNonFastForwardPush('! [rejected] spyglass/patch (non-fast-forward)')).toBe(true);
    expect(isNonFastForwardPush('! [rejected] spyglass/patch (fetch first)')).toBe(true);
    expect(
      isNonFastForwardPush(
        'hint: Updates were rejected because the tip of your current branch is behind'
      )
    ).toBe(true);
    expect(
      isNonFastForwardPush('! [rejected] spyglass/patch (protected branch hook declined)')
    ).toBe(false);
    expect(isNonFastForwardPush('! [rejected] spyglass/patch (pre-receive hook declined)')).toBe(
      false
    );
    expect(isNonFastForwardPush('! [rejected] spyglass/patch (shallow update not allowed)')).toBe(
      false
    );
    expect(
      isNonFastForwardPush('! [remote rejected] spyglass/patch (pre-receive hook declined)')
    ).toBe(false);
    expect(isNonFastForwardPush('remote: please fetch first and retry')).toBe(false);
  });

  it('does not delete the remote branch on a protected-branch push rejection (L7-202)', async () => {
    const dir = await tempDir('spyglass-lot7-l7202-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let deletedRemote = false;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push' && args.includes('--delete')) {
        deletedRemote = true;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'push' && args.includes('-u')) {
        return {
          stdout: '',
          stderr: '! [rejected] spyglass/patch (protected branch hook declined)',
          code: 1
        };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => false,
      createPr: async () => ({ ok: false })
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/protected branch/);
    expect(deletedRemote).toBe(false);
  });

  it('disables gh prompts with GH_PROMPT_DISABLED (L7-206)', async () => {
    const src = await readFile(new URL('./assisted-apply.ts', import.meta.url), 'utf8');
    const start = src.indexOf('function ghExecEnv');
    const end = src.indexOf('function gitFailureReason');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain("GH_PROMPT_DISABLED: '1'");
    expect(body).not.toContain('GH_PROMPT:');
  });

  it('logs caught gh errors to stderr while staying fail-closed (L7-110)', async () => {
    const logs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      const missing = join(tmpdir(), `spyglass-l7110-missing-${String(Date.now())}`);
      const listed = await defaultHasOpenPr({ repo: missing, branch: 'spyglass/patch-none' });
      expect(listed).toBe(true);
      const created = await tryGhPrCreate({
        repo: missing,
        branch: 'spyglass/patch-none',
        defaultBranch: 'main',
        title: 't',
        body: 'b'
      });
      expect(created.ok).toBe(false);
      expect(logs.some((line) => line.includes('gh pr list failed'))).toBe(true);
      expect(logs.some((line) => line.includes('gh pr create failed'))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it('treats non-array gh pr list JSON as open (L7-130)', () => {
    expect(openPrListMeansOpen([])).toBe(false);
    expect(openPrListMeansOpen([{ number: 1 }])).toBe(true);
    expect(openPrListMeansOpen({})).toBe(true);
    expect(openPrListMeansOpen(null)).toBe(true);
    expect(openPrListMeansOpen('nope')).toBe(true);
    expect(openPrListMeansOpen(1)).toBe(true);
  });

  it('refuses remote delete/recreate when an open PR exists (P14a)', async () => {
    const dir = await tempDir('spyglass-lot7-p14a-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let deletedRemote = false;
    let listedBranch: string | undefined;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push' && args.includes('--delete')) {
        deletedRemote = true;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'push' && args.includes('-u')) {
        return {
          stdout: '',
          stderr: '! [rejected] spyglass/patch (non-fast-forward)',
          code: 1
        };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async (input) => {
        listedBranch = input.branch;
        return true;
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('open-pr');
    expect(result.reason).toMatch(/open PR exists/);
    expect(result.reason).toMatch(/remote left unchanged/);
    expect(deletedRemote).toBe(false);
    expect(result.health?.appliedPatches).toBe(0);
    expect(result.branch).toBeDefined();
    expect(listedBranch).toBe(result.branch);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
    expect(head).not.toBe(result.branch);
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('re-checks open PR immediately before remote delete (L7-227)', async () => {
    const dir = await tempDir('spyglass-lot7-l7227-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let deletedRemote = false;
    let openPrChecks = 0;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push' && args.includes('--delete')) {
        deletedRemote = true;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (args[0] === 'push' && args.includes('-u')) {
        return {
          stdout: '',
          stderr: '! [rejected] spyglass/patch (non-fast-forward)',
          code: 1
        };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => {
        openPrChecks += 1;
        return openPrChecks > 1;
      },
      createPr: async () => ({ ok: false })
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('open-pr');
    expect(result.reason).toMatch(/open PR exists/);
    expect(deletedRemote).toBe(false);
    expect(openPrChecks).toBeGreaterThanOrEqual(2);
    const src = await readFile(new URL('./assisted-apply.ts', import.meta.url), 'utf8');
    const fn = src.slice(
      src.indexOf('async function pushPatchBranch'),
      src.indexOf('export function openPrListMeansOpen')
    );
    expect(fn).toContain('remoteDeleteBlockedByOpenPr');
    expect(fn.indexOf('blockedAgain')).toBeLessThan(fn.indexOf("['push', 'origin', '--delete'"));
  });

  it('restores the starting branch when dangling patch-branch delete fails (L7-099)', async () => {
    const dir = await tempDir('spyglass-lot7-l7099-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    await execFileAsync('git', ['checkout', '-b', 'feature'], { cwd: dir });
    const setHash = patchSetHash([
      { stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#new' }) }
    ]);
    const stale = patchBranchName('ses_lot7', setHash);
    await execFileAsync('git', ['checkout', '-b', stale], { cwd: dir });
    await execFileAsync('git', ['checkout', 'feature'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'branch' && args[1] === '-D') {
        return { stdout: '', stderr: 'cannot lock ref', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('git-error');
    }
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('feature');
    expect(head).not.toBe('main');
  });

  it('names the patch branch from the full toApply set (L7-101)', async () => {
    const dir = await tempDir('spyglass-lot7-l7101-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old-a'), clickStep(1, '#old-b')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    const suggested = (runId: string): SuggestedPatch => ({
      schemaVersion: 1,
      runId,
      sessionId: 'ses_lot7',
      applied: false,
      patches: [
        {
          stepIndex: 0,
          scope: 'action.descriptor',
          original: { type: 'click', selector: '#old-a' },
          suggested: { type: 'click', selector: '#a' },
          diagnosis: 'selector drift',
          confidence: 0.9
        },
        {
          stepIndex: 1,
          scope: 'action.descriptor',
          original: { type: 'click', selector: '#old-b' },
          suggested: { type: 'click', selector: '#b' },
          diagnosis: 'selector drift',
          confidence: 0.9
        }
      ]
    });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, suggested('run_a'), policy);
    health = recordSuggestedPatches(health, suggested('run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: suggested('run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({ url: 'https://github.com/example/target/pull/101' })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const full = patchSetHash([
      { stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#a' }) },
      { stepIndex: 1, hash: descriptorHash({ type: 'click', selector: '#b' }) }
    ]);
    const firstOnly = patchSetHash([
      { stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#a' }) }
    ]);
    expect(result.branch).toBe(patchBranchName('ses_lot7', full));
    expect(result.branch).not.toBe(patchBranchName('ses_lot7', firstOnly));
    const onPatch = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#a');
    expect(onPatch.steps[1]?.action.descriptor.selector).toBe('#b');
  });

  it('hashes every ReplayDescriptor identity field and ignores extras (L7-203)', () => {
    expect(REPLAY_DESCRIPTOR_IDENTITY_KEYS).toEqual([
      'type',
      'selector',
      'selectorStrategy',
      'description',
      'fallbackSelectors',
      'arguments',
      'framePath',
      'shadowPath'
    ]);
    const base = { type: 'click' as const, selector: '#a' };
    expect(descriptorHash({ ...base, selectorStrategy: 'css' })).not.toBe(descriptorHash(base));
    expect(descriptorHash({ ...base, description: 'go' })).not.toBe(descriptorHash(base));
    expect(descriptorHash({ ...base, fallbackSelectors: ['#b'] })).not.toBe(descriptorHash(base));
    expect(descriptorHash({ ...base, arguments: ['x'] })).not.toBe(descriptorHash(base));
    expect(descriptorHash({ ...base, framePath: ['main'] })).not.toBe(descriptorHash(base));
    expect(descriptorHash({ ...base, shadowPath: ['root'] })).not.toBe(descriptorHash(base));
    expect(descriptorHash({ ...base, extra: 'silent' } as typeof base & { extra: string })).toBe(
      descriptorHash(base)
    );
    const nestedLeft = {
      type: 'click' as const,
      selector: '#a',
      arguments: [{ z: '1', a: '2' }] as unknown as string[]
    };
    const nestedRight = {
      type: 'click' as const,
      selector: '#a',
      arguments: [{ a: '2', z: '1' }] as unknown as string[]
    };
    expect(descriptorHash(nestedLeft)).toBe(descriptorHash(nestedRight));
  });

  it('restores the starting branch when commit fails after checkout -b (L7-012)', async () => {
    const dir = await tempDir('spyglass-lot7-commitfail-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'commit') {
        return { stdout: '', stderr: 'commit failed', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('git-error');
      expect(result.reason).toMatch(/commit failed/);
    }
    const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    expect(branch.stdout.trim()).toBe('main');
  });

  it('restores the starting commit SHA when apply starts in detached HEAD (L7-119)', async () => {
    const dir = await tempDir('spyglass-lot7-l7119-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    const startSha = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    await writeFile(join(dir, 'later.txt'), 'later\n', 'utf8');
    await execFileAsync('git', ['add', 'later.txt'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'later'], { cwd: dir });
    const mainTip = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    expect(mainTip).not.toBe(startSha);
    await execFileAsync('git', ['checkout', '--detach', startSha], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'commit') {
        return { stdout: '', stderr: 'commit failed', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const detached = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(detached.ok).toBe(false);
    if (!detached.ok) {
      expect(detached.code).toBe('git-error');
      expect(detached.reason).toMatch(/commit failed/);
    }
    const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    const named = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(startSha);
    expect(head).not.toBe(mainTip);
    expect(named).toBe('HEAD');
  });

  it('refuses when default branch fallback is detached HEAD (L7-126)', async () => {
    const dir = await tempDir('spyglass-lot7-l7126-');
    await execFileAsync('git', ['init', '-b', 'develop'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'lot7@spyglass.test'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Lot7 Tests'], { cwd: dir });
    await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    await execFileAsync('git', ['checkout', '--detach'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unresolved-default');
      expect(result.reason).toMatch(/origin\/HEAD|main\/master/u);
    }
    const named = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(named).toBe('HEAD');
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
    const branches = (
      await execFileAsync('git', ['branch', '--list', 'spyglass/patch-*'], { cwd: dir })
    ).stdout.trim();
    expect(branches).toBe('');
  });

  it('refuses when only a non-default branch is checked out (G28b)', async () => {
    const dir = await tempDir('spyglass-lot7-g28b-checkout-');
    await execFileAsync('git', ['init', '-b', 'develop'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'lot7@spyglass.test'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Lot7 Tests'], { cwd: dir });
    await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unresolved-default');
      expect(result.reason).toMatch(/origin\/HEAD|main\/master/u);
    }
    const named = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(named).toBe('develop');
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
    const branches = (
      await execFileAsync('git', ['branch', '--list', 'spyglass/patch-*'], { cwd: dir })
    ).stdout.trim();
    expect(branches).toBe('');
  });

  it('returns git-error when checkout -b fails and restores starting branch (L7-025)', async () => {
    const dir = await tempDir('spyglass-lot7-checkout-b-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'checkout' && args[1] === '-b') {
        return {
          stdout: '',
          stderr: 'fatal: cannot lock ref',
          code: 128
        };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('git-error');
    }
    const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    expect(branch.stdout.trim()).toBe('main');
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
  });

  it('reloads scenario.json from the default branch after checkout (L7-048)', async () => {
    const dir = await tempDir('spyglass-lot7-reload-default-');
    await initGitRepo(dir);
    const mainStep = clickStep(0, '#old');
    mainStep.intent = 'from-main';
    const mainScn = scenario([mainStep]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(mainScn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    await execFileAsync('git', ['checkout', '-b', 'feature'], { cwd: dir });
    const featureStep = clickStep(0, '#old');
    featureStep.intent = 'from-feature';
    const featureScn = scenario([featureStep]);
    await writeFile(scenarioPath, `${JSON.stringify(featureScn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'feature copy'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: featureScn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('feature');
    const working = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(working.steps[0]?.intent).toBe('from-feature');
    expect(working.steps[0]?.action.descriptor.selector).toBe('#old');
    const patched = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(patched.steps[0]?.intent).toBe('from-main');
    expect(patched.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('reloads default-branch scenario after recreating a leftover patch branch (L7-134)', async () => {
    const dir = await tempDir('spyglass-lot7-l7134-');
    await initGitRepo(dir);
    const mainStep = clickStep(0, '#old');
    mainStep.intent = 'from-main';
    const mainScn = scenario([mainStep]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(mainScn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const leftover = patchBranchName(
      'ses_lot7',
      patchSetHash([{ stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#new' }) }])
    );
    await execFileAsync('git', ['checkout', '-b', leftover], { cwd: dir });
    const staleStep = clickStep(0, '#old');
    staleStep.intent = 'from-stale';
    const staleScn = scenario([staleStep]);
    await writeFile(scenarioPath, `${JSON.stringify(staleScn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'stale leftover'], { cwd: dir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: staleScn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({}),
      createPr: async () => ({ ok: true })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const patched = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(patched.steps[0]?.intent).toBe('from-main');
    expect(patched.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('does not skipMutate a leftover patch branch that also changes unrelated files (L7-168)', async () => {
    const dir = await tempDir('spyglass-lot7-l7168-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const leftover = patchBranchName(
      'ses_lot7',
      patchSetHash([{ stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#new' }) }])
    );
    await execFileAsync('git', ['checkout', '-b', leftover], { cwd: dir });
    const applied = scenario([clickStep(0, '#new')]);
    await writeFile(scenarioPath, `${JSON.stringify(applied, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'extra.txt'), 'unrelated\n', 'utf8');
    await execFileAsync('git', ['add', 'scenario.json', 'extra.txt'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'leftover with extra file'], { cwd: dir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({}),
      createPr: async () => ({ ok: true })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const names = (
      await execFileAsync('git', ['diff', '--name-only', `main...${result.branch}`], { cwd: dir })
    ).stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);
    expect(names).toEqual(['scenario.json']);
    await expect(
      execFileAsync('git', ['cat-file', '-e', `${result.branch}:extra.txt`], { cwd: dir })
    ).rejects.toThrow();
  });

  it('does not force-checkout default when leftover recovery sees a dirty tree (L7-213)', async () => {
    const src = await readFile(new URL('./assisted-apply.ts', import.meta.url), 'utf8');
    const leftoverStart = src.indexOf('if (leftoverExists)');
    const leftoverEnd = src.indexOf('let scenario = input.scenario');
    expect(leftoverStart).toBeGreaterThan(-1);
    expect(leftoverEnd).toBeGreaterThan(leftoverStart);
    const leftoverBlock = src.slice(leftoverStart, leftoverEnd);
    expect(leftoverBlock).not.toContain("'-f'");
    expect(leftoverBlock).toContain("['checkout', defaultBranch]");
    expect(leftoverBlock).toContain('isWorktreeDirty');
    const dir = await tempDir('spyglass-lot7-l7213-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const leftover = patchBranchName(
      'ses_lot7',
      patchSetHash([{ stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#new' }) }])
    );
    await execFileAsync('git', ['checkout', '-b', leftover], { cwd: dir });
    const applied = scenario([clickStep(0, '#new')]);
    await writeFile(scenarioPath, `${JSON.stringify(applied, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'extra.txt'), 'unrelated\n', 'utf8');
    await execFileAsync('git', ['add', 'scenario.json', 'extra.txt'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'leftover with extra file'], { cwd: dir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    let dirtyChecks = 0;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'checkout' && args[1] === '-f') {
        throw new Error('L7-213: leftover recovery must not git checkout -f');
      }
      if (args[0] === 'status' && args.includes('--porcelain')) {
        dirtyChecks += 1;
        if (dirtyChecks > 1) {
          return { stdout: ' M extra.txt\n', stderr: '', code: 0 };
        }
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('dirty-worktree');
    }
  });

  it('does not skipMutate a leftover scenario.json that also edits verification (L7-171)', async () => {
    const dir = await tempDir('spyglass-lot7-l7171-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const leftover = patchBranchName(
      'ses_lot7',
      patchSetHash([{ stepIndex: 0, hash: descriptorHash({ type: 'click', selector: '#new' }) }])
    );
    await execFileAsync('git', ['checkout', '-b', leftover], { cwd: dir });
    const applied = scenario([clickStep(0, '#new')]);
    const tampered = applied.steps[0];
    if (tampered === undefined) {
      throw new Error('expected step 0');
    }
    tampered.verification.expected = '#tampered';
    await writeFile(scenarioPath, `${JSON.stringify(applied, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'leftover with verification edit'], { cwd: dir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({}),
      createPr: async () => ({ ok: true })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const patched = await gitShowJson<Scenario>(dir, `${result.branch}:scenario.json`);
    expect(patched.steps[0]?.action.descriptor.selector).toBe('#new');
    expect(patched.steps[0]?.verification.expected).toBe('#old');
    const src = await readFile(new URL('./assisted-apply.ts', import.meta.url), 'utf8');
    expect(src).toContain('leftoverMatchesDescriptorOnlyApply');
    expect(src).toContain("git(['show'");
  });

  it('restores starting ref when leftover rev-parse fails (L7-172)', async () => {
    const dir = await tempDir('spyglass-lot7-l7172-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const first = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => {
        throw new Error('gh down');
      }
    });
    expect(first.ok).toBe(false);
    if (first.ok) {
      return;
    }
    expect(first.code).toBe('pr-prep-failed');
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir });
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        const head = (
          await defaultGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
        ).stdout.trim();
        if (head.startsWith('spyglass/patch-')) {
          return { stdout: '', stderr: 'fatal: rev-parse failed on patch branch', code: 128 };
        }
      }
      return await defaultGitExec(args, cwd);
    };
    const second = await applyAssistedPatches({
      health: first.health ?? health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({ url: 'https://github.com/example/target/pull/172' })
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.code).toBe('git-error');
    expect(second.reason).toMatch(/rev-parse failed on patch branch/);
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
  });

  it('returns pr-prep-failed when injected createPr throws (L7-173)', async () => {
    const dir = await tempDir('spyglass-lot7-l7173-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'push') {
        return { stdout: '', stderr: '', code: 0 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      hasOpenPr: async () => false,
      createPr: async () => {
        throw new Error('gh create exploded');
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('pr-prep-failed');
    expect(result.reason).toMatch(/gh create exploded/);
    expect(result.branch?.startsWith('spyglass/patch-')).toBe(true);
    expect(result.commit).toBeDefined();
    expect(result.health?.appliedPatches).toBe(0);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
  });

  it('refuses restore that would discard tracked edits other than scenario.json (L7-167)', async () => {
    const dir = await tempDir('spyglass-lot7-l7167-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    let statusCalls = 0;
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'status' && args.includes('--porcelain')) {
        statusCalls += 1;
        if (statusCalls > 2) {
          return { stdout: ' M extra.txt\n', stderr: '', code: 0 };
        }
      }
      if (args[0] === 'checkout' && args[1] === '-f') {
        throw new Error('L7-167: restore must not git checkout -f');
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('restore-failed');
      expect(result.reason).toMatch(/refusing to discard uncommitted changes: extra\.txt/);
    }
    const src = await readFile(new URL('./assisted-apply.ts', import.meta.url), 'utf8');
    const restoreFn = src.slice(
      src.indexOf('async function restoreStartingBranch'),
      src.indexOf('function trackedDirtyPaths')
    );
    expect(restoreFn).not.toContain("'-f'");
    expect(restoreFn).toContain("['reset', 'HEAD', '--', file]");
    expect(restoreFn).toContain("['checkout', target]");
  });

  it('unstages scenario.json on restore after a failed commit (L7-184)', async () => {
    const dir = await tempDir('spyglass-lot7-l7184-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'commit') {
        return { stdout: '', stderr: 'commit failed', code: 1 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('git-error');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe('main');
    const cached = (
      await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: dir })
    ).stdout.trim();
    expect(cached).toBe('');
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#old');
  });

  it('maps a throwing pre-mutation git probe to git-error (L7-144)', async () => {
    const dir = await tempDir('spyglass-lot7-l7144-');
    await initGitRepo(dir);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    health = recordSuggestedPatches(health, patch('#new', 'run_b'), policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'status') {
        throw new GitApplyError('status probe exploded');
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('git-error');
    expect(result.reason).toMatch(/status probe exploded/);
  });

  it('refuses a fill step with a click suggestion without rewriting type (L7-049)', async () => {
    const dir = await tempDir('spyglass-lot7-type-mismatch-');
    await initGitRepo(dir);
    const scn = scenario([fillStep(0, '#email', 'recorded', 'email')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    const suggested: SuggestedPatch = {
      schemaVersion: 1,
      runId: 'run_b',
      sessionId: 'ses_lot7',
      applied: false,
      patches: [
        {
          stepIndex: 0,
          scope: 'action.descriptor',
          original: { type: 'fill', selector: '#email', arguments: ['recorded'] },
          suggested: { type: 'click', selector: '#new' },
          diagnosis: 'type drift',
          confidence: 0.9
        }
      ]
    };
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, { ...suggested, runId: 'run_a' }, policy);
    health = recordSuggestedPatches(health, suggested, policy);
    const result = await applyAssistedPatches({
      health,
      suggested,
      scenario: scn,
      scenarioPath,
      policy,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('type-mismatch');
    }
    const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    expect(branch.stdout.trim()).toBe('main');
    const dangling = await execFileAsync('git', ['branch', '--list', 'spyglass/patch-*'], {
      cwd: dir
    });
    expect(dangling.stdout.trim()).toBe('');
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.type).toBe('fill');
    expect(onDisk.steps[0]?.action.descriptor.type).toBe('fill');
    expect(
      confirmedDescriptor({ type: 'fill', selector: '#email', arguments: ['recorded'] })
    ).toEqual({ type: 'fill', selector: '#email', arguments: ['recorded'] });
  });

  it('surfaces checkout -f restore failure in the refusal reason (L7-066)', async () => {
    const dir = await tempDir('spyglass-lot7-restore-fail-');
    await initGitRepo(dir);
    const scn = scenario([fillStep(0, '#email', 'recorded', 'email')]);
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: dir });
    const suggested: SuggestedPatch = {
      schemaVersion: 1,
      runId: 'run_b',
      sessionId: 'ses_lot7',
      applied: false,
      patches: [
        {
          stepIndex: 0,
          scope: 'action.descriptor',
          original: { type: 'fill', selector: '#email', arguments: ['recorded'] },
          suggested: { type: 'click', selector: '#new' },
          diagnosis: 'type drift',
          confidence: 0.9
        }
      ]
    };
    let health = emptyHealth('ses_lot7');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: dir });
    health = recordSuggestedPatches(health, { ...suggested, runId: 'run_a' }, policy);
    health = recordSuggestedPatches(health, suggested, policy);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'checkout' && args[1] !== '-b' && args[1] !== '--') {
        const head = (
          await defaultGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
        ).stdout.trim();
        if (head.startsWith('spyglass/patch-')) {
          return { stdout: '', stderr: 'fatal: cannot checkout starting branch', code: 128 };
        }
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await applyAssistedPatches({
      health,
      suggested,
      scenario: scn,
      scenarioPath,
      policy,
      git,
      preparePr: async () => ({})
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('type-mismatch');
      expect(result.reason).toMatch(/also failed to restore main/);
      expect(result.reason).toMatch(/cannot checkout starting branch/);
    }
  });

  it('maps non-git apply failures to internal-error (L7-052)', async () => {
    const root = await tempDir('spyglass-lot7-internal-');
    const repo = join(root, 'repo');
    const sessionDir = join(root, 'session');
    await mkdir(repo, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await initGitRepo(repo);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(repo, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: repo });
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo });
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    await saveHealth(sessionDir, health);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'commit') {
        throw new Error('EIO: unexpected disk failure');
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await processSuggestedPatch({
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      policy,
      scenarioPath,
      sessionDir,
      git
    });
    expect(result.assistedApply?.ok).toBe(false);
    if (result.assistedApply !== undefined && !result.assistedApply.ok) {
      expect(result.assistedApply.code).toBe('internal-error');
    }
    const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo });
    expect(branch.stdout.trim()).toBe('main');
  });

  it('classifies tagged GitApplyError as git-error without matching stderr (L7-075)', async () => {
    const root = await tempDir('spyglass-lot7-git-tag-');
    const repo = join(root, 'repo');
    const sessionDir = join(root, 'session');
    await mkdir(repo, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await initGitRepo(repo);
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(repo, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: repo });
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo });
    let health = emptyHealth('ses_lot7');
    health = recordSuggestedPatches(health, patch('#new', 'run_a'), policy);
    await saveHealth(sessionDir, health);
    const git = async (args: readonly string[], cwd: string) => {
      if (args[0] === 'commit') {
        return { stdout: '', stderr: 'index.lock held', code: 128 };
      }
      return await defaultGitExec(args, cwd);
    };
    const result = await processSuggestedPatch({
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      policy,
      scenarioPath,
      sessionDir,
      git
    });
    expect(result.assistedApply?.ok).toBe(false);
    if (result.assistedApply !== undefined && !result.assistedApply.ok) {
      expect(result.assistedApply.code).toBe('git-error');
      expect(result.assistedApply.reason).toMatch(/index\.lock held/);
    }
    expect(isGitApplyError(new GitApplyError('index.lock held'))).toBe(true);
    expect(isGitApplyError(new Error('git commit failed'))).toBe(false);
  });

  it('refuses assisted apply when scenarioPath is missing (L7-078)', async () => {
    const sessionDir = await tempDir('spyglass-lot7-nopath-');
    const scn = scenario([clickStep(0, '#old')]);
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo: sessionDir });
    const result = await processSuggestedPatch({
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      policy,
      sessionDir
    });
    expect(result.health).toBeDefined();
    expect(result.assistedApply?.ok).toBe(false);
    if (result.assistedApply !== undefined && !result.assistedApply.ok) {
      expect(result.assistedApply.code).toBe('missing-scenario-path');
    }
  });

  it('refuses assisted apply when sessionDir cannot be resolved (A30a)', async () => {
    const scn = scenario([clickStep(0, '#old')]);
    const policy = resolvePatchPolicy(
      { PATCH_ASSISTED_APPLY: 'true' },
      { repo: '/tmp/spyglass-a30a' }
    );
    const result = await processSuggestedPatch({
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      policy
    });
    expect(result.health).toBeUndefined();
    expect(result.assistedApply?.ok).toBe(false);
    if (result.assistedApply !== undefined && !result.assistedApply.ok) {
      expect(result.assistedApply.code).toBe('missing-session-dir');
      expect(result.assistedApply.reason).toMatch(/requires sessionDir/);
    }
    const off = await processSuggestedPatch({
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      policy: resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'false' })
    });
    expect(off).toEqual({});
    const src = await readFile(new URL('./patch-lifecycle.ts', import.meta.url), 'utf8');
    const fn = src.slice(
      src.indexOf('export async function processSuggestedPatch'),
      src.indexOf('export type ResolveScenarioPathResult')
    );
    expect(fn).toContain("code: 'missing-session-dir'");
    expect(fn.indexOf("code: 'missing-session-dir'")).toBeLessThan(
      fn.indexOf('applyAssistedPatches')
    );
    expect(fn).not.toMatch(/if \(sessionDir === undefined\) \{\s*return \{\};/);
  });

  it('refuses processSuggestedPatch when scenarioPath is outside --repo (S28b)', async () => {
    const sessionDir = await tempDir('spyglass-lot7-s28b-session-');
    const repo = await tempDir('spyglass-lot7-s28b-repo-');
    const outside = await tempDir('spyglass-lot7-s28b-out-');
    const scn = scenario([clickStep(0, '#old')]);
    const scenarioPath = join(outside, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo });
    const result = await processSuggestedPatch({
      suggested: patch('#new', 'run_b'),
      scenario: scn,
      policy,
      sessionDir,
      scenarioPath
    });
    expect(result.health).toBeDefined();
    expect(result.assistedApply?.ok).toBe(false);
    if (result.assistedApply !== undefined && !result.assistedApply.ok) {
      expect(result.assistedApply.code).toBe('scenario-outside-repo');
      expect(result.assistedApply.reason).toMatch(/outside the target --repo/u);
    }
  });

  it('folds DEFAULT_BRANCH_NAMES into isDefaultBranchName (L7-031)', () => {
    expect(isDefaultBranchName('main')).toBe(true);
    expect(isDefaultBranchName('master')).toBe(true);
    expect(isDefaultBranchName('develop')).toBe(false);
    expect(isDefaultBranchName('develop', 'develop')).toBe(true);
  });
});

describe('resolveScenarioPath S28b', () => {
  const repo = resolve(tmpdir(), 'spyglass-s28b-lexical-repo');

  it('resolves a relative path that stays inside the repo (L7-036)', () => {
    const result = resolveScenarioPath(join('generated', 'scenario.json'), repo);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(resolve(repo, 'generated', 'scenario.json'));
    }
  });

  it('refuses a relative path that escapes the repo', () => {
    const result = resolveScenarioPath(join('..', 'other', 'scenario.json'), repo);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('scenario-outside-repo');
      expect(result.reason).toMatch(/outside the target --repo/u);
    }
  });

  it('refuses an absolute path outside the repo', () => {
    const result = resolveScenarioPath(
      resolve(tmpdir(), 'spyglass-s28b-other', 'scenario.json'),
      repo
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('scenario-outside-repo');
    }
  });

  it('accepts an absolute path inside the repo', () => {
    const inside = resolve(repo, 'scenario.json');
    const result = resolveScenarioPath(inside, repo);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(inside);
    }
  });

  it('resolves a relative repo before containment (L7-243)', () => {
    // Cwd-relative (not tmpdir): Windows path.relative() across drives is absolute.
    const relativeRepo = join('spyglass-s28b-rel-repo');
    expect(isAbsolute(relativeRepo)).toBe(false);
    const absRepo = resolve(relativeRepo);
    const inside = resolve(absRepo, 'scenario.json');
    const result = resolveScenarioPath(inside, relativeRepo);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(inside);
    }
  });

  it('returns missing-scenario-path when the path is empty', () => {
    const result = resolveScenarioPath('', repo);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing-scenario-path');
    }
  });

  it('resolves repo to absolute before isInsideRepo (L7-243)', async () => {
    const src = await readFile(new URL('./patch-lifecycle.ts', import.meta.url), 'utf8');
    const fn = src.slice(
      src.indexOf('export function resolveScenarioPath'),
      src.indexOf('export async function loadDatasetFile')
    );
    expect(fn).toContain('const repoAbs = resolve(repo)');
    expect(fn.indexOf('const repoAbs = resolve(repo)')).toBeLessThan(
      fn.indexOf('isInsideRepo(repoAbs')
    );
  });
});

describe('detectDefaultBranch G28b', () => {
  const cwd = '/tmp/spyglass-g28b-unused';

  function refsGit(opts: { originHead?: string; local?: string[]; remote?: string[] }): GitExec {
    return async (args) => {
      if (args[0] === 'symbolic-ref' && args.includes('refs/remotes/origin/HEAD')) {
        if (opts.originHead !== undefined) {
          return {
            stdout: `refs/remotes/origin/${opts.originHead}\n`,
            stderr: '',
            code: 0
          };
        }
        return { stdout: '', stderr: '', code: 1 };
      }
      if (args[0] === 'rev-parse' && args.includes('--verify')) {
        const ref = args[args.length - 1] ?? '';
        if (opts.local?.some((name) => ref === `refs/heads/${name}`)) {
          return { stdout: 'abc\n', stderr: '', code: 0 };
        }
        if (opts.remote?.some((name) => ref === `refs/remotes/origin/${name}`)) {
          return { stdout: 'abc\n', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 1 };
      }
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
        return { stdout: 'develop\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: 'unexpected git probe', code: 1 };
    };
  }

  it('uses origin/HEAD even when it is not named main/master', async () => {
    await expect(detectDefaultBranch(refsGit({ originHead: 'develop' }), cwd)).resolves.toBe(
      'develop'
    );
  });

  it('uses remote origin/main when local main/master and origin/HEAD are missing', async () => {
    await expect(detectDefaultBranch(refsGit({ remote: ['main'] }), cwd)).resolves.toBe('main');
  });

  it('does not fall back to the checked-out branch (G28b)', async () => {
    const git = refsGit({});
    await expect(detectDefaultBranch(git, cwd)).rejects.toSatisfy(isUnresolvedDefaultBranchError);
    await expect(detectDefaultBranch(git, cwd)).rejects.toThrow(/origin\/HEAD|main\/master/u);
  });
});

describe('Lot 7 health.json wiring after recovery', () => {
  it('records a candidate after a recovered run and does not mutate suggested-patch applied', async () => {
    const sessionDir = await tempDir('spyglass-lot7-health-');
    const reportDir = join(sessionDir, 'runs', 'run_lot7');
    await mkdir(reportDir, { recursive: true });
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#gone', visible: false },
        { selector: '#ok', visible: true }
      ]
    });
    driver.failSelectors.add('#gone');
    const broken = clickStep(0, '#gone');
    broken.verification.expected = '#ok';
    broken.verification.timeoutMs = 50;
    const result = await runScenario(scenario([broken]), {
      driver,
      aiRecovery: true,
      recoverer: new StaticRecoverer({ type: 'click', selector: '#ok' }, 'recovered'),
      reportDir,
      sessionDir,
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    expect(result.suggestedPatch?.applied).toBe(false);
    const health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates).toHaveLength(1);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.status).toBe('healthy');
  });

  it('resets candidates after a clean success so a later recovery does not promote (L7-028)', async () => {
    const sessionDir = await tempDir('spyglass-lot7-clean-run-');
    const broken = clickStep(0, '#target');
    broken.verification.expected = '#alive';
    broken.verification.timeoutMs = 50;
    const scn = scenario([broken]);
    const recover = async (runId: string) => {
      const driver = new MemoryPageDriver({
        url: 'https://exemple.test/start',
        elements: [
          { selector: '#target', visible: false },
          { selector: '#alt', visible: true },
          { selector: '#alive', visible: true }
        ]
      });
      driver.failSelectors.add('#target');
      return await runScenario(scn, {
        driver,
        aiRecovery: true,
        recoverer: new StaticRecoverer({ type: 'click', selector: '#alt' }, 'recovered'),
        reportDir: join(sessionDir, 'runs', runId),
        sessionDir,
        runId,
        env: { PATCH_ASSISTED_APPLY: 'false' }
      });
    };
    await recover('run_a');
    let health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);

    const cleanDriver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#target', visible: true },
        { selector: '#alive', visible: true }
      ]
    });
    const clean = await runScenario(scn, {
      driver: cleanDriver,
      aiRecovery: false,
      reportDir: join(sessionDir, 'runs', 'run_b'),
      sessionDir,
      runId: 'run_b',
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    expect(clean.exitCode).toBe(0);
    expect(clean.suggestedPatch).toBeUndefined();
    health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates).toEqual([]);

    await recover('run_c');
    health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates).toHaveLength(1);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_c']);
  });

  it('keeps the report when health.json cannot be loaded after write (L7-216)', async () => {
    const sessionDir = await tempDir('spyglass-lot7-l7216-');
    const reportDir = join(sessionDir, 'runs', 'run_lot7');
    await mkdir(reportDir, { recursive: true });
    await mkdir(join(sessionDir, 'health.json'));
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [{ selector: '#go', visible: true }]
    });
    const result = await runScenario(scenario([clickStep(0, '#go')]), {
      driver,
      aiRecovery: false,
      reportDir,
      sessionDir,
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.exitCode).toBe(0);
    expect(result.assistedApply?.ok).toBe(false);
    if (result.assistedApply !== undefined && !result.assistedApply.ok) {
      expect(result.assistedApply.code).toBe('internal-error');
    }
    const reportRaw = await readFile(join(reportDir, 'report.json'), 'utf8');
    expect(reportRaw).toContain('ses_lot7');
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    const lifecycle = src.slice(
      src.indexOf('const lifecycleInput'),
      src.indexOf('if (runDir !== undefined)')
    );
    expect(lifecycle).toContain('try {');
    expect(lifecycle).toContain('await processSuggestedPatch(lifecycleInput)');
    expect(lifecycle).toContain('suggested: liveSuggested');
    expect(lifecycle).toContain("code: 'internal-error'");
  });

  it('does not reset candidates on a failed empty-patch run (L7-153)', async () => {
    const sessionDir = await tempDir('spyglass-lot7-l7153-');
    const broken = clickStep(0, '#target');
    broken.verification.expected = '#alive';
    broken.verification.timeoutMs = 50;
    const scn = scenario([broken]);
    const recoverDriver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#target', visible: false },
        { selector: '#alt', visible: true },
        { selector: '#alive', visible: true }
      ]
    });
    recoverDriver.failSelectors.add('#target');
    await runScenario(scn, {
      driver: recoverDriver,
      aiRecovery: true,
      recoverer: new StaticRecoverer({ type: 'click', selector: '#alt' }, 'recovered'),
      reportDir: join(sessionDir, 'runs', 'run_a'),
      sessionDir,
      runId: 'run_a',
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    let health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates).toHaveLength(1);

    const failDriver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#target', visible: false },
        { selector: '#alive', visible: false }
      ]
    });
    const failed = await runScenario(scn, {
      driver: failDriver,
      aiRecovery: false,
      reportDir: join(sessionDir, 'runs', 'run_fail'),
      sessionDir,
      runId: 'run_fail',
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    expect(failed.exitCode).toBe(1);
    expect(failed.suggestedPatch).toBeUndefined();
    health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates).toHaveLength(1);
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_a']);

    const stopDriver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#target', visible: true },
        { selector: '#alive', visible: true }
      ]
    });
    const stopped = await runScenario(scn, {
      driver: stopDriver,
      aiRecovery: false,
      reportDir: join(sessionDir, 'runs', 'run_stop'),
      sessionDir,
      runId: 'run_stop',
      env: { PATCH_ASSISTED_APPLY: 'false' },
      stepGate: {
        wait: async () => 'stop'
      }
    });
    expect(stopped.exitCode).toBe(1);
    expect(stopped.suggestedPatch).toBeUndefined();
    health = await loadHealth(sessionDir, 'ses_lot7');
    expect(health.patchCandidates).toHaveLength(1);
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_a']);
  });

  it('does not write dataset secrets into scenario.json on assisted apply (L7-019)', {
    timeout: GIT_TEST_MS
  }, async () => {
    const root = await tempDir('spyglass-lot7-dataset-persist-');
    const repo = join(root, 'repo');
    const sessionDir = join(root, 'session');
    await mkdir(repo, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await initGitRepo(repo);
    const click = clickStep(1, '#old');
    click.verification.expected = '#new';
    click.verification.timeoutMs = 50;
    const scn = scenario([fillStep(0, '#password', 'recorded-secret', 'password'), click]);
    const scenarioPath = join(repo, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: repo });
    const datasetPath = join(root, 'dataset.json');
    await writeFile(
      datasetPath,
      `${JSON.stringify({ schemaVersion: 1, name: 'live', values: { password: 'dataset-secret' }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    const inner = new StaticRecoverer({ type: 'click', selector: '#new' }, 'recovered');
    const recoverer: Recoverer = {
      recover: async (context) => {
        expect(JSON.stringify(context)).not.toMatch(/dataset-secret/);
        return await inner.recover(context);
      }
    };
    for (const runId of ['run_a', 'run_b'] as const) {
      const driver = new MemoryPageDriver({
        url: 'https://exemple.test/start',
        elements: [
          { selector: '#password', visible: true, value: '' },
          { selector: '#old', visible: false },
          { selector: '#new', visible: true }
        ]
      });
      driver.failSelectors.add('#old');
      const result = await runScenario(scn, {
        driver,
        aiRecovery: true,
        recoverer,
        reportDir: join(sessionDir, 'runs', runId),
        sessionDir,
        scenarioPath,
        repo,
        datasetPath,
        runId,
        env: { PATCH_ASSISTED_APPLY: 'true' },
        git: defaultGitExec,
        preparePr: async () => ({})
      });
      expect(driver.fills.map((row) => row.value)).toEqual(['dataset-secret']);
      expect(JSON.stringify(result.suggestedPatch ?? {})).not.toMatch(/dataset-secret/);
      if (runId === 'run_b') {
        expect(result.assistedApply?.ok).toBe(true);
        if (result.assistedApply?.ok === true) {
          const onPatch = await gitShowJson<Scenario>(
            repo,
            `${result.assistedApply.branch}:scenario.json`
          );
          expect(onPatch.steps[0]?.action.descriptor.arguments?.[0]).toBe('recorded-secret');
          expect(onPatch.steps[1]?.action.descriptor.selector).toBe('#new');
        }
      }
    }
    const working = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(working.steps[0]?.action.descriptor.arguments?.[0]).toBe('recorded-secret');
    expect(working.steps[1]?.action.descriptor.selector).toBe('#old');
  });

  it('applies live fill args and keeps health/artifacts scrubbed (L7-230)', async () => {
    const root = await tempDir('spyglass-lot7-l7230-');
    const repo = join(root, 'repo');
    const sessionDir = join(root, 'session');
    await mkdir(repo, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await initGitRepo(repo);
    const secret = 'live-dataset-secret';
    const scn = scenario([fillStep(0, '#password', 'recorded-secret', 'password')]);
    const scenarioPath = join(repo, 'scenario.json');
    await writeFile(scenarioPath, `${JSON.stringify(scn, null, 2)}\n`, 'utf8');
    await execFileAsync('git', ['add', 'scenario.json'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: repo });
    const livePatch = (runId: string): SuggestedPatch => ({
      schemaVersion: 1,
      runId,
      sessionId: 'ses_lot7',
      applied: false,
      patches: [
        {
          stepIndex: 0,
          scope: 'action.descriptor',
          original: { type: 'fill', selector: '#password', arguments: ['recorded-secret'] },
          suggested: { type: 'fill', selector: '#password-new', arguments: [secret] },
          diagnosis: 'selector drift',
          confidence: 0.9
        }
      ]
    });
    const policy = resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'true' }, { repo });
    const first = await processSuggestedPatch({
      suggested: livePatch('run_a'),
      scenario: scn,
      policy,
      scenarioPath,
      sessionDir,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(JSON.stringify(first.health ?? {})).not.toMatch(secret);
    expect(first.health?.patchCandidates[0]?.descriptorHash).toBe(
      descriptorHash({ type: 'fill', selector: '#password-new' })
    );
    const second = await processSuggestedPatch({
      suggested: livePatch('run_b'),
      scenario: scn,
      policy,
      scenarioPath,
      sessionDir,
      git: defaultGitExec,
      preparePr: async () => ({})
    });
    expect(second.assistedApply?.ok).toBe(true);
    if (second.assistedApply?.ok !== true) {
      return;
    }
    const onPatch = await gitShowJson<Scenario>(
      repo,
      `${second.assistedApply.branch}:scenario.json`
    );
    expect(onPatch.steps[0]?.action.descriptor.selector).toBe('#password-new');
    expect(onPatch.steps[0]?.action.descriptor.arguments?.[0]).toBe(secret);
    expect(onPatch.steps[0]?.action.descriptor.arguments?.[0]).not.toBeNull();
    const healthDisk = await loadHealth(sessionDir, 'ses_lot7');
    expect(JSON.stringify(healthDisk)).not.toMatch(secret);
    const src = await readFile(new URL('./patch-lifecycle.ts', import.meta.url), 'utf8');
    const fn = src.slice(
      src.indexOf('export async function processSuggestedPatch'),
      src.indexOf('export type ResolveScenarioPathResult')
    );
    expect(fn).toContain('const persisted = redactSuggestedPatchForPersistence');
    expect(fn).toContain('recordSuggestedPatches(health, persisted, policy)');
    expect(fn).toContain('suggested: input.suggested');
    expect(fn.indexOf('suggested: input.suggested')).toBeGreaterThan(
      fn.indexOf('recordSuggestedPatches(health, persisted, policy)')
    );
  });

  it('strips dataset secrets from suggested fill args before disk and health (P13a)', async () => {
    const root = await tempDir('spyglass-lot7-p13a-');
    const sessionDir = join(root, 'session');
    const reportDir = join(sessionDir, 'runs', 'run_p13a');
    await mkdir(reportDir, { recursive: true });
    const secret = 'dataset-secret';
    const datasetPath = join(root, 'dataset.json');
    await writeFile(
      datasetPath,
      `${JSON.stringify({ schemaVersion: 1, name: 'live', values: { password: secret }, secrets: ['password'] }, null, 2)}\n`,
      'utf8'
    );
    const fill = fillStep(0, '#password', 'recorded-secret', 'password');
    fill.verification.expected = '#welcome';
    fill.verification.timeoutMs = 50;
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#password', visible: false },
        { selector: '#password-new', visible: true, value: '' },
        { selector: '#welcome', visible: true }
      ]
    });
    driver.failSelectors.add('#password');
    const inner = new StaticRecoverer(
      { type: 'fill', selector: '#password-new', arguments: [secret] },
      'recovered fill'
    );
    const recoverer: Recoverer = {
      recover: async (context) => {
        expect(JSON.stringify(context)).not.toMatch(secret);
        return await inner.recover(context);
      }
    };
    const result = await runScenario(scenario([fill]), {
      driver,
      aiRecovery: true,
      recoverer,
      reportDir,
      sessionDir,
      datasetPath,
      runId: 'run_p13a',
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    expect(result.exitCode).toBe(0);
    expect(driver.fills.some((row) => row.value === secret)).toBe(true);
    expect(JSON.stringify(result.suggestedPatch ?? {})).not.toMatch(secret);
    expect(result.suggestedPatch?.patches[0]?.suggested.selector).toBe('#password-new');
    expect(result.suggestedPatch?.patches[0]?.suggested.arguments).toBeUndefined();
    expect(result.suggestedPatch?.patches[0]?.original.arguments).toBeUndefined();
    const disk = JSON.parse(
      await readFile(join(reportDir, 'suggested-patch.json'), 'utf8')
    ) as SuggestedPatch;
    expect(JSON.stringify(disk)).not.toMatch(secret);
    expect(disk.patches[0]?.suggested.arguments).toBeUndefined();
    const health = await loadHealth(sessionDir, 'ses_lot7');
    expect(JSON.stringify(health)).not.toMatch(secret);
    expect(health.patchCandidates).toHaveLength(1);
    expect(health.patchCandidates[0]?.descriptorHash).toBe(
      descriptorHash({ type: 'fill', selector: '#password-new' })
    );
  });

  it('resolves recorded steps by index when the array is reordered (L7-123)', async () => {
    const secret = 'dataset-secret';
    const click = clickStep(0, '#go');
    const fill = fillStep(2, '#password', 'recorded-secret', 'password');
    fill.verification.expected = '#welcome';
    fill.verification.timeoutMs = 50;
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/login',
      elements: [
        { selector: '#password', visible: false },
        { selector: '#password-new', visible: true, value: '' },
        { selector: '#welcome', visible: true },
        { selector: '#go', visible: true }
      ]
    });
    driver.failSelectors.add('#password');
    const recoverer = new StaticRecoverer(
      { type: 'fill', selector: '#password-new', arguments: [secret] },
      'recovered fill'
    );
    const result = await runScenario(scenario([fill, click]), {
      driver,
      aiRecovery: true,
      recoverer,
      env: {}
    });
    expect(result.exitCode).toBe(0);
    const recovered = result.suggestedPatch?.patches.find((entry) => entry.stepIndex === 2);
    expect(recovered).toBeDefined();
    expect(recovered?.suggested.selector).toBe('#password-new');
    expect(recovered?.suggested.arguments).toBeUndefined();
    expect(recovered?.original.arguments).toBeUndefined();
    expect(JSON.stringify(result.suggestedPatch ?? {})).not.toMatch(secret);
    expect(JSON.stringify(result.suggestedPatch ?? {})).not.toMatch('recorded-secret');
  });
});

describe('resolveSessionDir', () => {
  it('maps runs/<runId> and generated/scenario.json to the session root', () => {
    expect(resolveSessionDir({ reportDir: '/sessions/ses_a/runs/run_1' })).toBe('/sessions/ses_a');
    expect(resolveSessionDir({ scenarioPath: '/sessions/ses_a/generated/scenario.json' })).toBe(
      '/sessions/ses_a'
    );
  });
});

describe('saveHealth schema', () => {
  it('round-trips a valid health.json', async () => {
    const dir = await tempDir('spyglass-lot7-save-');
    const health = emptyHealth('ses_lot7');
    await saveHealth(dir, health);
    const disk = JSON.parse(await readFile(join(dir, 'health.json'), 'utf8')) as unknown;
    expect(disk).toMatchObject({ schemaVersion: 1, status: 'healthy', appliedPatches: 0 });
  });

  it('publishes health.json via temp + rename (L7-149)', async () => {
    const dir = await tempDir('spyglass-lot7-l7149-');
    await saveHealth(dir, emptyHealth('ses_lot7'));
    const names = await readdir(dir);
    expect(names.filter((name) => name.includes('.tmp-'))).toEqual([]);
    expect(names).toContain('health.json');
    const src = await readFile(new URL('./health.ts', import.meta.url), 'utf8');
    expect(src).toContain('await rename(tmp, path)');
    expect(src).not.toMatch(/await writeFile\(path,/);
  });

  it('returns empty health when health.json is missing (L7-010)', async () => {
    const dir = await tempDir('spyglass-lot7-enoent-');
    const health = await loadHealth(dir, 'ses_lot7');
    expect(health).toEqual(emptyHealth('ses_lot7'));
  });

  it('throws on corrupt health.json and does not replace the file (L7-010)', async () => {
    const dir = await tempDir('spyglass-lot7-corrupt-');
    const path = join(dir, 'health.json');
    await writeFile(path, '{not json', 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(/corrupt health.json: invalid JSON/);
    expect(await readFile(path, 'utf8')).toBe('{not json');
  });

  it('throws on schema-invalid health.json (L7-010)', async () => {
    const dir = await tempDir('spyglass-lot7-badschema-');
    const path = join(dir, 'health.json');
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1 })}\n`, 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(
      /corrupt health.json: schema validation failed/
    );
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schemaVersion: 1 });
  });

  it('throws when loaded health.json sessionId does not match (L7-050)', async () => {
    const dir = await tempDir('spyglass-lot7-session-mismatch-');
    const foreign = {
      schemaVersion: 1,
      sessionId: 'ses_other',
      status: 'stale',
      appliedPatches: 4,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:deadbeef',
          consecutiveRuns: 2,
          lastRunId: 'run_x',
          runIds: ['run_w', 'run_x']
        }
      ]
    };
    await writeFile(join(dir, 'health.json'), `${JSON.stringify(foreign, null, 2)}\n`, 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(/health.json sessionId mismatch/);
    expect(JSON.parse(await readFile(join(dir, 'health.json'), 'utf8'))).toEqual(foreign);
  });
});

describe('loadHealth H21a runIds migration', () => {
  it('fills missing runIds from lastRunId without bumping schemaVersion', async () => {
    const dir = await tempDir('spyglass-lot7-h21a-missing-');
    const fixtureText = await readFile(
      new URL(
        '../../../docs/contracts/examples/invalid/health.missing-runids.json',
        import.meta.url
      ),
      'utf8'
    );
    const path = join(dir, 'health.json');
    await writeFile(path, fixtureText, 'utf8');
    const health = await loadHealth(dir, 'ses_20260907_demo');
    expect(health.schemaVersion).toBe(1);
    expect(health.patchCandidates[0]?.lastRunId).toBe('run_0001');
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_0001']);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(JSON.parse(fixtureText));
  });

  it('does not invent extra runIds when consecutiveRuns is 2 but only lastRunId exists', async () => {
    const dir = await tempDir('spyglass-lot7-h21a-consec-');
    const disk = {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 2,
          lastRunId: 'run_0002'
        }
      ]
    };
    await writeFile(join(dir, 'health.json'), `${JSON.stringify(disk)}\n`, 'utf8');
    const health = await loadHealth(dir, 'ses_lot7');
    expect(health.schemaVersion).toBe(1);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_0002']);
  });

  it('recomputes consecutiveRuns to the migrated runIds window (L7-214)', async () => {
    const dir = await tempDir('spyglass-lot7-l7214-');
    const disk = {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 99,
          lastRunId: 'run_only'
        }
      ]
    };
    await writeFile(join(dir, 'health.json'), `${JSON.stringify(disk)}\n`, 'utf8');
    const health = await loadHealth(dir, 'ses_lot7');
    expect(health.patchCandidates[0]?.runIds).toEqual(['run_only']);
    expect(health.patchCandidates[0]?.consecutiveRuns).toBe(1);
    const migrated = migrateHealthPatchCandidates({
      sessionId: 'ses_x',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 2,
          lastRunId: 'run_a'
        }
      ]
    }) as { patchCandidates: Array<{ consecutiveRuns: number; runIds: string[] }> };
    expect(migrated.patchCandidates[0]?.runIds).toEqual(['run_a']);
    expect(migrated.patchCandidates[0]?.consecutiveRuns).toBe(1);
  });

  it('rejects current-schema runIds that contain empty entries (L7-242)', async () => {
    const dir = await tempDir('spyglass-lot7-h21a-empty-ids-');
    const disk = {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 1,
          lastRunId: 'run_a',
          runIds: ['', 'run_a']
        }
      ]
    };
    await writeFile(join(dir, 'health.json'), `${JSON.stringify(disk)}\n`, 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(
      /corrupt health.json: schema validation failed/
    );
  });

  it('still rejects missing runIds at the raw schema (L7-128)', () => {
    const payload = {
      schemaVersion: 1,
      sessionId: 'ses_x',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 1,
          lastRunId: 'run_a'
        }
      ]
    };
    expect(validateUnknown('health', payload).valid).toBe(false);
    expect(validateHealth(payload).valid).toBe(true);
  });

  it('still fails load when a candidate has no derivable runIds', async () => {
    const dir = await tempDir('spyglass-lot7-h21a-underived-');
    const disk = {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 1,
          lastRunId: ''
        }
      ]
    };
    await writeFile(join(dir, 'health.json'), `${JSON.stringify(disk)}\n`, 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(
      /corrupt health.json: schema validation failed/
    );
  });

  it('calls migrateHealthPatchCandidates before validateHealth on load', async () => {
    const src = await readFile(new URL('./health.ts', import.meta.url), 'utf8');
    const loadFn = src.slice(
      src.indexOf('export async function loadHealth'),
      src.indexOf('export async function saveHealth')
    );
    expect(loadFn.indexOf('migrateHealthPatchCandidates')).toBeGreaterThan(-1);
    expect(loadFn.indexOf('migrateHealthPatchCandidates')).toBeLessThan(
      loadFn.indexOf('validateHealth')
    );
    expect(loadFn).toContain('checked.data');
  });

  it('does not invent schemaVersion when migrating', () => {
    const migrated = migrateHealthPatchCandidates({
      sessionId: 'ses_x',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: [
        {
          stepIndex: 0,
          descriptorHash: 'sha256:abc',
          consecutiveRuns: 1,
          lastRunId: 'run_a'
        }
      ]
    });
    expect(migrated).toMatchObject({
      patchCandidates: [{ runIds: ['run_a'], lastRunId: 'run_a' }]
    });
    expect(migrated).not.toHaveProperty('schemaVersion');
  });
});
