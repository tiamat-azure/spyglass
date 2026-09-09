import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep, Scenario, SuggestedPatch } from '@spyglass/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { descriptorHash } from './descriptor-hash.ts';
import { emptyHealth, loadHealth, recordSuggestedPatches } from './health.ts';
import { resolvePatchPolicy } from './patch-config.ts';
import { processSuggestedPatch } from './patch-lifecycle.ts';
import { originalDescriptorForPatch, redactSuggestedPatchForPersistence } from './patch-redact.ts';
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

  it('keeps non-parameterized fill args', () => {
    const redacted = redactSuggestedPatchForPersistence(leakyFillPatch('visible-user'), {
      schemaVersion: 1,
      sessionId: 'ses_lot7',
      startUrl: 'https://exemple.test/login',
      steps: [fillStep('#email', 'visible-user')]
    });
    expect(redacted.patches[0]?.suggested.arguments).toEqual(['visible-user']);
    expect(redacted.patches[0]?.original.arguments).toEqual(['visible-user']);
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
