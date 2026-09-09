import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  RefinedStep,
  Scenario,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { applyAssistedPatches, assertAssistedApplyAllowed } from './assisted-apply.ts';
import { descriptorHash } from './descriptor-hash.ts';
import { defaultGitExec } from './git-repo.ts';
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
import { StaticRecoverer } from './recover.ts';
import { runScenario } from './run.ts';

const execFileAsync = promisify(execFile);

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

describe('Lot 7 F-64 assisted git/PR path', () => {
  it('does not apply when PATCH_ASSISTED_APPLY is false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-off-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-git-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-pr-'));
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
    expect(head).toBe(result.branch);
    expect(head).not.toBe('main');
    const mainStill = (
      await execFileAsync('git', ['rev-parse', 'main'], { cwd: dir })
    ).stdout.trim();
    expect(mainStill).toBe(mainSha);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
    expect(onDisk.steps[0]?.patchHistory?.[0]?.scope).toBe('action.descriptor');
    expect(result.health.appliedPatches).toBe(1);
  });

  it('does not claim PR preparation when git push fails (L7-002)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-pushfail-'));
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
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.prPrepared).toBe(false);
    expect(result.merged).toBe(false);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
  });

  it('replaces the descriptor with the confirmed suggestion only (L7-003)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-desc-'));
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
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    const descriptor = onDisk.steps[0]?.action.descriptor;
    expect(descriptor).toEqual({ type: 'click', selector: '#new' });
    expect(descriptor?.fallbackSelectors).toBeUndefined();
    expect(descriptor?.arguments).toBeUndefined();
    expect(descriptorHash(descriptor ?? { type: 'click', selector: '#new' })).toBe(
      descriptorHash({ type: 'click', selector: '#new' })
    );
  });

  it('refuses a scenario.json symlink that escapes --repo (L7-009)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-lot7-symlink-'));
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

  it('keeps ok:true and increments health when preparePr throws (L7-011)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-prthrow-'));
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
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.prPrepared).toBe(false);
    expect(result.health.appliedPatches).toBe(1);
    const onDisk = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    expect(onDisk.steps[0]?.action.descriptor.selector).toBe('#new');
    const head = (
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    ).stdout.trim();
    expect(head).toBe(result.branch);
  });

  it('restores the starting branch when commit fails after checkout -b (L7-012)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-commitfail-'));
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
});

describe('Lot 7 health.json wiring after recovery', () => {
  it('records a candidate after a recovered run and does not mutate suggested-patch applied', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-health-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-save-'));
    const health = emptyHealth('ses_lot7');
    await saveHealth(dir, health);
    const disk = JSON.parse(await readFile(join(dir, 'health.json'), 'utf8')) as unknown;
    expect(disk).toMatchObject({ schemaVersion: 1, status: 'healthy', appliedPatches: 0 });
  });

  it('returns empty health when health.json is missing (L7-010)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-enoent-'));
    const health = await loadHealth(dir, 'ses_lot7');
    expect(health).toEqual(emptyHealth('ses_lot7'));
  });

  it('throws on corrupt health.json and does not replace the file (L7-010)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-corrupt-'));
    const path = join(dir, 'health.json');
    await writeFile(path, '{not json', 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(/corrupt health.json: invalid JSON/);
    expect(await readFile(path, 'utf8')).toBe('{not json');
  });

  it('throws on schema-invalid health.json (L7-010)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot7-badschema-'));
    const path = join(dir, 'health.json');
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1 })}\n`, 'utf8');
    await expect(loadHealth(dir, 'ses_lot7')).rejects.toThrow(
      /corrupt health.json: schema validation failed/
    );
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schemaVersion: 1 });
  });
});
