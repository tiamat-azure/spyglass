import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  RefinedStep,
  Scenario,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAssistedPatches,
  assertAssistedApplyAllowed,
  confirmedDescriptor,
  defaultHasOpenPr,
  tryGhPrCreate
} from './assisted-apply.ts';
import { descriptorHash, patchSetHash } from './descriptor-hash.ts';
import {
  defaultGitExec,
  GIT_EXEC_TIMEOUT_MS,
  GitApplyError,
  isDefaultBranchName,
  isGitApplyError,
  patchBranchName
} from './git-repo.ts';
import {
  emptyHealth,
  healthStatus,
  loadHealth,
  recordSuggestedPatches,
  resolveSessionDir,
  saveHealth
} from './health.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import { resolvePatchPolicy } from './patch-config.ts';
import { processSuggestedPatch } from './patch-lifecycle.ts';
import { type Recoverer, StaticRecoverer } from './recover.ts';
import { runScenario } from './run.ts';

const execFileAsync = promisify(execFile);
const tmpDirs: string[] = [];
const GIT_TEST_MS = process.platform === 'win32' ? 20_000 : 10_000;

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
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(result.branch);
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
    await symlink(outsideFile, scenarioPath);
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
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(result.branch);
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

  it('times out hung git exec instead of waiting forever (L7-093)', async () => {
    expect(GIT_EXEC_TIMEOUT_MS).toBe(120_000);
    const dir = await tempDir('spyglass-lot7-gitexec-');
    await initGitRepo(dir);
    const result = await defaultGitExec(
      ['rev-parse', '--verify', 'refs/heads/spyglass-missing-branch'],
      dir
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr.trim().length).toBeGreaterThan(0);
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
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(result.branch);
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
    await expect(
      applyAssistedPatches({
        health,
        suggested: patch('#new', 'run_b'),
        scenario: scn,
        scenarioPath,
        policy,
        git
      })
    ).rejects.toThrow(/commit failed/);
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
    await expect(
      applyAssistedPatches({
        health,
        suggested: patch('#new', 'run_b'),
        scenario: scn,
        scenarioPath,
        policy,
        git
      })
    ).rejects.toThrow(/commit failed/);
    const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    const named = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(startSha);
    expect(head).not.toBe(mainTip);
    expect(named).toBe('HEAD');
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
      if (args[0] === 'checkout' && args[1] === '-f') {
        return { stdout: '', stderr: 'fatal: cannot checkout starting branch', code: 128 };
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

  it('folds DEFAULT_BRANCH_NAMES into isDefaultBranchName (L7-031)', () => {
    expect(isDefaultBranchName('main')).toBe(true);
    expect(isDefaultBranchName('master')).toBe(true);
    expect(isDefaultBranchName('develop')).toBe(false);
    expect(isDefaultBranchName('develop', 'develop')).toBe(true);
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
