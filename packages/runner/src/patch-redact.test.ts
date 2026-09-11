import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep, Scenario, SuggestedPatch } from '@spyglass/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { descriptorHash } from './descriptor-hash.ts';
import { emptyHealth, loadHealth, recordSuggestedPatches } from './health.ts';
import { resolvePatchPolicy } from './patch-config.ts';
import { processSuggestedPatch } from './patch-lifecycle.ts';
import {
  originalDescriptorForPatch,
  originalWithoutLiveFillArgs,
  overlayLiveArgumentsForRecovery,
  redactSuggestedPatchEntryForPersistence,
  redactSuggestedPatchForPersistence
} from './patch-redact.ts';
import { writeRunArtifacts } from './report.ts';

const tmpDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tmpDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function fillStep(selector: string, value: string, ref?: string): RefinedStep {
  const step: RefinedStep = {
    index: 0,
    intent: 'Je saisis',
    action: {
      type: 'fill',
      descriptor: { type: 'fill', selector, arguments: [value] }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: ['evt_000001']
  };
  if (ref !== undefined) {
    step.action.parameterRef = ref;
  }
  return step;
}

function leakyFillPatch(secret: string): SuggestedPatch {
  return {
    schemaVersion: 1,
    runId: 'run_p13a',
    sessionId: 'ses_lot7',
    applied: false,
    patches: [
      {
        stepIndex: 0,
        scope: 'action.descriptor',
        original: { type: 'fill', selector: '#password', arguments: [secret] },
        suggested: { type: 'fill', selector: '#password-new', arguments: [secret] },
        diagnosis: 'selector drift',
        confidence: 0.9
      }
    ]
  };
}

describe('P13a patch secret redaction', () => {
  it('strips parameterized original args (L7-038)', () => {
    const step = fillStep('#password', 'recorded-secret', 'password');
    const original = originalDescriptorForPatch(step);
    expect(original.arguments).toBeUndefined();
    expect(original.selector).toBe('#password');
  });

  it('keeps trailing args when stripping parameterized original (A27b)', () => {
    const step = fillStep('#user', 'alice', 'user');
    step.action.descriptor.arguments = ['alice', 'slowly', 'ltr'];
    const original = originalDescriptorForPatch(step);
    expect(original.arguments?.[0]).toBeNull();
    expect(original.arguments?.slice(1)).toEqual(['slowly', 'ltr']);
    expect(JSON.stringify(original)).not.toMatch('alice');
  });

  it('redacts parameterized [0] but keeps trailing args (A27b / P13a)', () => {
    const secret = 'dataset-secret';
    const step = fillStep('#password', secret, 'password');
    step.action.descriptor.arguments = [secret, 'slowly'];
    const redacted = redactSuggestedPatchForPersistence(
      {
        schemaVersion: 1,
        runId: 'run_p13a',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'action.descriptor',
            original: { type: 'fill', selector: '#password', arguments: [secret, 'slowly'] },
            suggested: { type: 'fill', selector: '#password-new', arguments: [secret, 'slowly'] },
            diagnosis: 'selector drift',
            confidence: 0.9
          }
        ]
      },
      {
        schemaVersion: 1,
        sessionId: 'ses_lot7',
        startUrl: 'https://exemple.test/login',
        steps: [step]
      }
    );
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.original.arguments?.[0]).toBeNull();
    expect(redacted.patches[0]?.original.arguments?.slice(1)).toEqual(['slowly']);
    expect(redacted.patches[0]?.suggested.arguments?.[0]).toBeNull();
    expect(redacted.patches[0]?.suggested.arguments?.slice(1)).toEqual(['slowly']);
  });

  it('keeps a non-string head when scrubbing known values (L7-254)', () => {
    const step = fillStep('#user', 'alice');
    const redacted = redactSuggestedPatchForPersistence(
      {
        schemaVersion: 1,
        runId: 'run_l7254',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'action.descriptor',
            original: {
              type: 'fill',
              selector: '#user',
              arguments: [{ delay: 1 }, 'ltr'] as unknown as string[]
            },
            suggested: {
              type: 'fill',
              selector: '#user-new',
              arguments: [12, { dir: 'rtl' }] as unknown as string[]
            },
            diagnosis: 'selector drift',
            confidence: 0.9
          }
        ]
      },
      {
        schemaVersion: 1,
        sessionId: 'ses_lot7',
        startUrl: 'https://exemple.test/login',
        steps: [step]
      }
    );
    expect(redacted.patches[0]?.original.arguments).toEqual([{ delay: 1 }, 'ltr']);
    expect(redacted.patches[0]?.suggested.arguments).toEqual([12, { dir: 'rtl' }]);
  });

  it('strips proposed/after args when the recorded step has parameterRef', () => {
    const secret = 'dataset-secret';
    const redacted = redactSuggestedPatchForPersistence(leakyFillPatch(secret), {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep('#password', 'recorded-secret', 'password')]
    });
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.original.arguments).toBeUndefined();
    expect(redacted.patches[0]?.suggested.arguments).toBeUndefined();
    expect(redacted.patches[0]?.suggested.selector).toBe('#password-new');
  });

  it('strips suggested fill args when original was already L7-038-redacted', () => {
    const secret = 'dataset-secret';
    const redacted = redactSuggestedPatchForPersistence({
      schemaVersion: 1,
      runId: 'run_p13a',
      sessionId: 'ses_lot7',
      applied: false,
      patches: [
        {
          stepIndex: 0,
          scope: 'action.descriptor',
          original: { type: 'fill', selector: '#password' },
          suggested: { type: 'fill', selector: '#password-new', arguments: [secret] },
          diagnosis: 'selector drift',
          confidence: 0.9
        }
      ]
    });
    expect(redacted.patches[0]?.suggested.arguments).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toMatch(secret);
  });

  it('keeps non-parameterized non-secret fill args', () => {
    const redacted = redactSuggestedPatchForPersistence(
      {
        schemaVersion: 1,
        runId: 'run_p13a',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'action.descriptor',
            original: { type: 'fill', selector: '#email', arguments: ['visible-user'] },
            suggested: { type: 'fill', selector: '#email-new', arguments: ['visible-user'] },
            diagnosis: 'selector drift',
            confidence: 0.9
          }
        ]
      },
      {
        schemaVersion: 1,
        sessionId: 'ses_lot7',
        startUrl: 'https://exemple.test/login',
        steps: [fillStep('#email', 'visible-user')]
      }
    );
    expect(redacted.patches[0]?.suggested.arguments).toEqual(['visible-user']);
    expect(redacted.patches[0]?.original.arguments).toEqual(['visible-user']);
  });

  it('strips secret-named fill args even without parameterRef (P28b)', () => {
    const secret = 'dataset-secret';
    const redacted = redactSuggestedPatchForPersistence(leakyFillPatch(secret), {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep('#password', secret)]
    });
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.original.arguments).toBeUndefined();
    expect(redacted.patches[0]?.suggested.arguments).toBeUndefined();
  });

  it('strips known parameter values from a non-parameterized sibling fill (P28b)', () => {
    const secret = 'dataset-secret';
    const email = fillStep('#email', 'alice');
    const password = fillStep('#password', secret, 'password');
    password.index = 1;
    const redacted = redactSuggestedPatchForPersistence(
      {
        schemaVersion: 1,
        runId: 'run_p28b',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'action.descriptor',
            original: { type: 'fill', selector: '#email', arguments: [secret] },
            suggested: { type: 'fill', selector: '#email-new', arguments: [secret] },
            diagnosis: 'selector drift',
            confidence: 0.9
          }
        ]
      },
      {
        schemaVersion: 1,
        sessionId: 'ses_lot7',
        startUrl: 'https://exemple.test/login',
        steps: [email, password]
      }
    );
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.original.arguments).toBeUndefined();
    expect(redacted.patches[0]?.suggested.arguments).toBeUndefined();
    expect(redacted.patches[0]?.suggested.selector).toBe('#email-new');
  });

  it('scrubs a trailing arg that equals a known secret (P28b)', () => {
    const secret = 'dataset-secret';
    const user = fillStep('#user', 'alice');
    user.action.descriptor.arguments = ['alice', secret];
    const password = fillStep('#password', secret, 'password');
    password.index = 1;
    const redacted = redactSuggestedPatchForPersistence(
      {
        schemaVersion: 1,
        runId: 'run_p28b',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'action.descriptor',
            original: { type: 'fill', selector: '#user', arguments: ['alice', secret] },
            suggested: { type: 'fill', selector: '#user-new', arguments: ['alice', secret] },
            diagnosis: 'selector drift',
            confidence: 0.9
          }
        ]
      },
      {
        schemaVersion: 1,
        sessionId: 'ses_lot7',
        startUrl: 'https://exemple.test/login',
        steps: [user, password]
      }
    );
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.original.arguments).toEqual(['alice', null]);
    expect(redacted.patches[0]?.suggested.arguments).toEqual(['alice', null]);
  });

  it('preserves trailing JSON args and vacant secret slots (L7-232)', () => {
    const secret = 'dataset-secret';
    const user = fillStep('#user', 'alice');
    user.action.descriptor.arguments = ['alice', secret, { delay: 1 }] as unknown as string[];
    const password = fillStep('#password', secret, 'password');
    password.index = 1;
    const redacted = redactSuggestedPatchForPersistence(
      {
        schemaVersion: 1,
        runId: 'run_l7232',
        sessionId: 'ses_lot7',
        applied: false,
        patches: [
          {
            stepIndex: 0,
            scope: 'action.descriptor',
            original: {
              type: 'fill',
              selector: '#user',
              arguments: ['alice', secret, { delay: 1 }] as unknown as string[]
            },
            suggested: {
              type: 'fill',
              selector: '#user-new',
              arguments: ['alice', secret, { delay: 1 }] as unknown as string[]
            },
            diagnosis: 'selector drift',
            confidence: 0.9
          }
        ]
      },
      {
        schemaVersion: 1,
        sessionId: 'ses_lot7',
        startUrl: 'https://exemple.test/login',
        steps: [user, password]
      }
    );
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.original.arguments).toEqual(['alice', null, { delay: 1 }]);
    expect(redacted.patches[0]?.suggested.arguments?.[2]).toEqual({ delay: 1 });
    expect(redacted.patches[0]?.original.arguments?.[1]).toBeNull();
  });

  it('omits live fill/select args when the recorded step is missing (L7-236)', () => {
    const original = originalWithoutLiveFillArgs({
      type: 'fill',
      selector: '#password',
      arguments: ['live-secret']
    });
    expect(original.arguments).toBeUndefined();
    expect(original.selector).toBe('#password');
    const click = originalWithoutLiveFillArgs({ type: 'click', selector: '#go' });
    expect(click.type).toBe('click');
    expect(click.arguments).toBeUndefined();
  });

  it('run.ts does not persist a live descriptor as suggested-patch original (L7-236)', async () => {
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toContain('originalWithoutLiveFillArgs');
    expect(src).not.toContain('cloneDescriptor(step.action.descriptor)');
  });

  it('scrubs by value on a single entry without a scenario (P28b)', () => {
    const secret = 'dataset-secret';
    const entry = leakyFillPatch(secret).patches[0];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const redacted = redactSuggestedPatchEntryForPersistence(entry, fillStep('#password', secret));
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.suggested.arguments).toBeUndefined();
  });

  it('strips fill/select suggested args when the recorded step cannot be resolved (L7-106)', () => {
    const secret = 'dataset-secret';
    const redacted = redactSuggestedPatchForPersistence(leakyFillPatch(secret));
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.suggested.arguments).toBeUndefined();
    expect(redacted.patches[0]?.original.arguments).toBeUndefined();
  });

  it('strips fill args when recorded step indexes are ambiguous (L7-106)', () => {
    const secret = 'dataset-secret';
    const first = fillStep('#email', 'visible-user');
    const duplicate = fillStep('#password', 'recorded-secret', 'password');
    duplicate.index = 0;
    const redacted = redactSuggestedPatchForPersistence(leakyFillPatch(secret), {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      startUrl: 'https://exemple.test/login',
      steps: [first, duplicate]
    });
    expect(JSON.stringify(redacted)).not.toMatch(secret);
    expect(redacted.patches[0]?.suggested.arguments).toBeUndefined();
  });

  it('overlays unique live fill args for recovery (L7-131)', () => {
    const live = fillStep('#password', 'dataset-secret', 'password');
    const recorded = originalDescriptorForPatch(live);
    expect(recorded.arguments).toBeUndefined();
    const overlaid = overlayLiveArgumentsForRecovery(recorded, live);
    expect(overlaid.arguments).toEqual(['dataset-secret']);
  });

  it('keeps navigate URL args', () => {
    const redacted = redactSuggestedPatchForPersistence({
      schemaVersion: 1,
      runId: 'run_p13a',
      sessionId: 'ses_lot7',
      applied: false,
      patches: [
        {
          stepIndex: 0,
          scope: 'action.descriptor',
          original: {
            type: 'navigate',
            selector: 'https://exemple.test/start',
            arguments: ['https://exemple.test/start']
          },
          suggested: {
            type: 'navigate',
            selector: 'https://exemple.test/next',
            arguments: ['https://exemple.test/next']
          },
          diagnosis: 'url drift',
          confidence: 0.9
        }
      ]
    });
    expect(redacted.patches[0]?.suggested.arguments).toEqual(['https://exemple.test/next']);
  });

  it('does not write dataset secrets into suggested-patch.json', async () => {
    const dir = await tempDir('spyglass-p13a-disk-');
    const secret = 'dataset-secret';
    const scenario: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep('#password', 'recorded-secret', 'password')]
    };
    await writeRunArtifacts({
      runDir: dir,
      scenario,
      report: {
        schemaVersion: 1,
        runId: 'run_p13a',
        sessionId: 'ses_lot7',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
        exitCode: 0,
        headless: true,
        aiRecovery: true,
        maxAiRetries: 1,
        smartModel: 'test',
        multimodal: false,
        warnings: [],
        steps: []
      },
      suggestedPatch: leakyFillPatch(secret)
    });
    const raw = await readFile(join(dir, 'suggested-patch.json'), 'utf8');
    expect(raw).not.toMatch(secret);
    const disk = JSON.parse(raw) as SuggestedPatch;
    expect(disk.patches[0]?.suggested.arguments).toBeUndefined();
    expect(disk.patches[0]?.original.arguments).toBeUndefined();
  });

  it('hashes stripped suggested descriptors into health candidates', async () => {
    const sessionDir = await tempDir('spyglass-p13a-health-');
    await mkdir(sessionDir, { recursive: true });
    const secret = 'dataset-secret';
    const scenario: Scenario = {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep('#password', 'recorded-secret', 'password')]
    };
    const result = await processSuggestedPatch({
      suggested: leakyFillPatch(secret),
      scenario,
      sessionDir,
      env: { PATCH_ASSISTED_APPLY: 'false' }
    });
    expect(JSON.stringify(result.health ?? {})).not.toMatch(secret);
    expect(result.health?.patchCandidates).toHaveLength(1);
    expect(result.health?.patchCandidates[0]?.descriptorHash).toBe(
      descriptorHash({ type: 'fill', selector: '#password-new' })
    );
    const disk = await loadHealth(sessionDir, 'ses_lot7');
    expect(JSON.stringify(disk)).not.toMatch(secret);
    const hashedWithSecret = recordSuggestedPatches(
      emptyHealth('ses_lot7'),
      leakyFillPatch(secret),
      resolvePatchPolicy({ PATCH_ASSISTED_APPLY: 'false' })
    );
    expect(hashedWithSecret.patchCandidates[0]?.descriptorHash).not.toBe(
      result.health?.patchCandidates[0]?.descriptorHash
    );
  });
});
