import { mkdirSync, unlinkSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawEvent, RefinedStep } from '@spyglass/contracts';
import { canFinalize, createMockTransport, LlmGateway, refineFromRaw } from '@spyglass/llm';
import { writeGeneratedFromRevision, writeGeneratedPackage } from '@spyglass/runner';
import { describe, expect, it } from 'vitest';
import {
  applyCorrelatedObserveEnrichment,
  nextRevision,
  observeMatchScore,
  type RefinedRevisionFile,
  RefineEngine
} from './refine-engine.ts';
import type { RecorderState, SessionOrchestrator } from './session-orchestrator.ts';

type FakeSession = {
  state: RecorderState;
  dir: string;
  id: string;
  events: RawEvent[];
  currentSessionDir: () => string;
  currentSessionId: () => string;
  canRefine: () => boolean;
  readRawEvents: () => Promise<RawEvent[]>;
  snapshot: () => { state: RecorderState; since: number; sessionId: string };
  beginRefine: () => void;
  finishRefineReview: () => void;
  abortRefine: (had: boolean) => void;
  finalizeScenario: () => void;
};

function click(id: string, ts: number, url: string, stepIndex: number): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_lot4',
    ts,
    stepIndex,
    kind: 'dom.click',
    target: {
      tag: 'button',
      id: 'go',
      testId: 'go',
      accessibleName: 'Go',
      role: 'button',
      framePath: ['main'],
      shadowPath: []
    },
    action: {
      type: 'click',
      selector: '[data-testid="go"]',
      selectorStrategy: 'testId',
      fallbackSelectors: ['#go'],
      framePath: ['main'],
      shadowPath: []
    },
    page: { url, title: 'Page' }
  };
}

function fill(id: string, ts: number): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_lot4',
    ts,
    stepIndex: 2,
    kind: 'dom.input',
    target: {
      tag: 'input',
      id: 'name',
      testId: 'name',
      accessibleName: 'Name',
      framePath: ['main'],
      shadowPath: []
    },
    action: {
      type: 'fill',
      selector: '[data-testid="name"]',
      selectorStrategy: 'testId',
      framePath: ['main'],
      shadowPath: []
    },
    value: { masked: false, text: 'Ada' },
    page: { url: 'https://app.example.test/form', title: 'Form' }
  };
}

function cssClick(id: string, ts: number, selector: string): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_lot4',
    ts,
    kind: 'dom.click',
    target: { tag: 'div', framePath: ['main'], shadowPath: [] },
    action: { type: 'click', selector, selectorStrategy: 'css' },
    page: { url: 'https://app.example.test', title: 'X' }
  };
}

function weakCssStep(index: number, selector: string, intent: string): RefinedStep {
  return {
    index,
    intent,
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector,
        selectorStrategy: 'css'
      }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'weak',
      weakReason: 'ambiguous-target',
      confirmedByUser: false
    },
    sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
  };
}

async function makeSession(events: RawEvent[]): Promise<FakeSession> {
  const dir = await mkdtemp(join(tmpdir(), 'spyglass-refine-'));
  const sessionDir = join(dir, 'ses_lot4');
  await mkdir(sessionDir, { recursive: true });
  const startUrl = events.find((event) => typeof event.page?.url === 'string')?.page?.url;
  if (startUrl === undefined || startUrl.length === 0) {
    throw new Error('test session events need page.url for meta.json startUrl');
  }
  await writeFile(
    join(sessionDir, 'meta.json'),
    `${JSON.stringify({ startUrl }, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    join(sessionDir, 'raw.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8'
  );
  const session: FakeSession = {
    state: 'sealed',
    dir: sessionDir,
    id: 'ses_lot4',
    events,
    currentSessionDir: () => session.dir,
    currentSessionId: () => session.id,
    canRefine: () => session.state === 'sealed' || session.state === 'reviewing',
    readRawEvents: async () => session.events,
    snapshot: () => ({ state: session.state, since: 1, sessionId: session.id }),
    beginRefine: () => {
      session.state = 'refining';
    },
    finishRefineReview: () => {
      session.state = 'reviewing';
    },
    abortRefine: (had) => {
      session.state = had ? 'reviewing' : 'sealed';
    },
    finalizeScenario: () => {
      session.state = 'finalized';
    }
  };
  return session;
}

function engineFor(
  session: FakeSession,
  options?: {
    observe?: () => Promise<{ ok: boolean; observations: Array<{ selector?: string }> }>;
    threshold?: number;
    offline?: boolean;
    generate?: (sessionDir: string, file: RefinedRevisionFile) => Promise<void>;
  }
): RefineEngine {
  const gateway = new LlmGateway({
    transport: createMockTransport({ delayMs: 1, tokensPerCall: 40 }),
    profiles: () => ({
      fast: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        timeoutMs: 50
      },
      smart: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        timeoutMs: 50
      }
    })
  });
  return new RefineEngine({
    session: () => session as unknown as SessionOrchestrator,
    refine: async (raw, aggressiveness) => gateway.refine(raw, aggressiveness),
    model: () => 'claude-sonnet-4-5-20250929',
    confirmThreshold: () => options?.threshold ?? 100_000,
    offline: () => options?.offline === true,
    observe: options?.observe,
    generate: options?.generate
  });
}

describe('RefineEngine', () => {
  it('writes rev-1.json without mutating raw.jsonl and versions relaunch', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    const before = await readFile(join(session.dir, 'raw.jsonl'), 'utf8');
    const engine = engineFor(session);
    const first = await engine.run('balanced', false);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.revision.revision).toBe(1);
    expect(first.revision.steps.length).toBeGreaterThan(0);
    expect(first.revision.steps.every((step) => step.sourceEvents.length > 0)).toBe(true);
    const after = await readFile(join(session.dir, 'raw.jsonl'), 'utf8');
    expect(after).toBe(before);
    const disk = JSON.parse(await readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')) as {
      steps: RefinedStep[];
    };
    expect(disk.steps[0]?.sourceEvents[0]?.startsWith('evt_')).toBe(true);

    const second = await engine.run('aggressive', false);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.revision.revision).toBe(2);
    expect(await readFile(join(session.dir, 'raw.jsonl'), 'utf8')).toBe(before);
  });

  it('blocks finalize on unconfirmed weak; routine batch vs one-by-one doubtful', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    const engine = engineFor(session);
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    expect(ran.revision.canFinalize).toBe(false);
    const blocked = await engine.finalize();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toMatch(/unconfirmed weak/);
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    expect(routine.revision.routineUnconfirmed).toBe(0);
    const still = await engine.finalize();
    expect(still.ok).toBe(false);
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    expect(doubtful.length).toBeGreaterThan(0);
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    const edited = await engine.edit(0, "Je parcours l'application");
    expect(edited.ok).toBe(true);
    const done = await engine.finalize();
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.revision.status).toBe('finalized');
      expect(canFinalize(engine.currentRevision()?.steps ?? [])).toBe(true);
    }
    expect(session.state).toBe('finalized');
    const generated = await readFile(join(session.dir, 'generated', 'scenario.ts'), 'utf8');
    expect(generated).toContain('runScenario');
    const scenarioJson = JSON.parse(
      await readFile(join(session.dir, 'generated', 'scenario.json'), 'utf8')
    ) as { sessionId: string };
    expect(scenarioJson.sessionId).toBe('ses_lot4');
  });

  it('does not leave the session stuck if generate fails (L6-001)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    let failGenerate = true;
    const engine = engineFor(session, {
      generate: async (sessionDir, file) => {
        if (failGenerate) {
          failGenerate = false;
          throw new Error('disk full');
        }
        await writeGeneratedFromRevision(sessionDir, file);
      }
    });
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    expect(engine.view()?.canFinalize).toBe(true);

    const failed = await engine.finalize();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/disk full/);
    }
    expect(session.state).toBe('reviewing');
    expect(engine.currentRevision()?.status).toBe('reviewing');
    expect(engine.view()?.canFinalize).toBe(true);
    const diskAfterFail = JSON.parse(
      await readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')
    ) as { status: string };
    expect(diskAfterFail.status).toBe('reviewing');

    const retry = await engine.finalize();
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.revision.status).toBe('finalized');
      expect(retry.revision.canFinalize).toBe(false);
    }
    expect(session.state).toBe('finalized');
    const generated = await readFile(join(session.dir, 'generated', 'scenario.ts'), 'utf8');
    expect(generated).toContain('runScenario');
  });

  it('deletes leftover generated/ if persist fails after generate-first (L6-004)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    const engine = engineFor(session, {
      generate: async (sessionDir, file) => {
        await writeGeneratedFromRevision(sessionDir, file);
        const rawPath = join(sessionDir, 'raw.jsonl');
        await writeFile(rawPath, `${await readFile(rawPath, 'utf8')}\n`, 'utf8');
      }
    });
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    const failed = await engine.finalize();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/raw\.jsonl mutated/);
    }
    expect(session.state).toBe('reviewing');
    expect(engine.currentRevision()?.status).toBe('reviewing');
    expect(engine.view()?.canFinalize).toBe(true);
    await expect(access(join(session.dir, 'generated', 'scenario.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('discards generated/ if generate writes then throws (L6-005)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    const engine = engineFor(session, {
      generate: async (sessionDir, file) => {
        await writeGeneratedFromRevision(sessionDir, file);
        throw new Error('mid-write');
      }
    });
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    const failed = await engine.finalize();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/mid-write/);
    }
    expect(session.state).toBe('reviewing');
    expect(engine.view()?.canFinalize).toBe(true);
    await expect(access(join(session.dir, 'generated', 'scenario.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('keeps a previously good generated/ if regenerate throws (D61a / L6-061)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    await writeGeneratedPackage({
      sessionDir: session.dir,
      scenario: {
        schemaVersion: 1,
        sessionId: 'ses_lot4',
        startUrl: 'https://keep.test/good',
        generatedAt: '2026-09-08T12:00:00.000Z',
        steps: []
      }
    });
    const engine = engineFor(session, {
      generate: async () => {
        throw new Error('mid-write');
      }
    });
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    const failed = await engine.finalize();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/mid-write/);
    }
    const kept = JSON.parse(
      await readFile(join(session.dir, 'generated', 'scenario.json'), 'utf8')
    ) as { startUrl: string };
    expect(kept.startUrl).toBe('https://keep.test/good');
  });

  it('surfaces persistRevision rollback failure instead of silent diverge (R33a / L6-033)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    session.finalizeScenario = () => {
      const revPath = join(session.dir, 'refined', 'rev-1.json');
      unlinkSync(revPath);
      mkdirSync(revPath);
      throw new Error('orchestrator explode');
    };
    const engine = engineFor(session);
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    const failed = await engine.finalize();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/orchestrator explode/);
      expect(failed.error).toMatch(/failed to persist reviewing rollback/i);
    }
    expect(session.state).toBe('reviewing');
  });

  it('rolls back reviewing on persistRevision failure after generate (R42a / L6-042)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'nav.load',
        page: { url: 'https://app.example.test/b', title: 'B' }
      },
      fill('evt_000003', 3),
      click('evt_000004', 4, 'https://app.example.test/b', 3)
    ];
    const session = await makeSession(events);
    const engine = engineFor(session, {
      generate: async (sessionDir, file) => {
        await writeGeneratedFromRevision(sessionDir, file);
        const revPath = join(sessionDir, 'refined', `rev-${String(file.revision)}.json`);
        unlinkSync(revPath);
        mkdirSync(revPath);
      }
    });
    const ran = await engine.run('balanced', false);
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      return;
    }
    const routine = await engine.confirm({ routine: true });
    expect(routine.ok).toBe(true);
    if (!routine.ok) {
      return;
    }
    const doubtful = routine.revision.steps.filter(
      (step) => step.strength === 'weak' && step.weakGroup === 'doubtful' && !step.confirmedByUser
    );
    for (const step of doubtful) {
      const one = await engine.confirm({ index: step.index });
      expect(one.ok).toBe(true);
    }
    const failed = await engine.finalize();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/EISDIR|illegal operation on a directory/i);
      expect(failed.error).toMatch(/failed to persist reviewing rollback/i);
    }
    expect(session.state).toBe('reviewing');
    expect(engine.view()?.canFinalize).toBe(true);
  });

  it('requires explicit confirm above the per-operation smart threshold', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const engine = engineFor(session, { threshold: 1 });
    const estimate = await engine.estimate('balanced');
    expect(estimate.requiresConfirm).toBe(true);
    const denied = await engine.run('balanced', false);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.needsConfirm).toBe(true);
    }
    const allowed = await engine.run('balanced', true);
    expect(allowed.ok).toBe(true);
  });

  it('refuses refine when smart is offline and groups observe() only if descriptors are insufficient', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const offline = engineFor(session, { offline: true });
    const refused = await offline.run('balanced', true);
    expect(refused.ok).toBe(false);

    let observeCalls = 0;
    const insufficient: RawEvent[] = [
      {
        schemaVersion: 1,
        id: 'evt_000010',
        sessionId: 'ses_lot4',
        ts: 1,
        kind: 'dom.click',
        target: { tag: 'div', framePath: ['main'], shadowPath: [] },
        action: { type: 'click', selector: '', selectorStrategy: 'css' },
        page: { url: 'https://app.example.test', title: 'X' }
      }
    ];
    const weakSession = await makeSession(insufficient);
    const observed = engineFor(weakSession, {
      observe: async () => {
        observeCalls += 1;
        return { ok: true, observations: [{ selector: '#repaired', description: 'repaired' }] };
      }
    });
    const result = await observed.run('balanced', true);
    expect(result.ok).toBe(true);
    expect(observeCalls).toBe(1);
    if (result.ok) {
      expect(result.revision.observeEnrichment).toBe(true);
    }
    expect(
      observed.currentRevision()?.steps[0]?.action.descriptor.fallbackSelectors ?? []
    ).not.toContain('#repaired');

    observeCalls = 0;
    const good = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const skip = engineFor(good, {
      observe: async () => {
        observeCalls += 1;
        return { ok: true, observations: [] };
      }
    });
    await skip.run('balanced', true);
    expect(observeCalls).toBe(0);
  });

  it('surfaces source fallback on the revision view (LOT4-R1)', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const steps = refineFromRaw(session.events, 'balanced');
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => ({
        ok: true,
        steps,
        source: 'fallback',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1
      }),
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false
    });
    const result = await engine.run('balanced', false);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.revision.source).toBe('fallback');
    expect(engine.view()?.source).toBe('fallback');
  });

  it('ignores a late run after reset / foreign sessionId (LOT4-R2)', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const steps = refineFromRaw(session.events, 'balanced');
    let release: () => void = () => {
      /* set below */
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted: () => void = () => {
      /* set below */
    };
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishCalls = 0;
    const originalFinish = session.finishRefineReview;
    session.finishRefineReview = () => {
      finishCalls += 1;
      originalFinish();
    };
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => {
        markStarted();
        await gate;
        return {
          ok: true,
          steps,
          source: 'smart',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1
        };
      },
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false
    });
    const pending = engine.run('balanced', false);
    await started;
    session.id = 'ses_foreign';
    session.state = 'recording';
    engine.reset();
    release();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/aborted/);
    }
    expect(engine.currentRevision()).toBeUndefined();
    expect(finishCalls).toBe(0);
    expect(session.state).toBe('recording');
    await expect(readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')).rejects.toThrow();
  });

  it('deletes a late-abort rev-N.json so nextRevision does not skip the orphan (P2-3)', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const steps = refineFromRaw(session.events, 'balanced');
    let trip = true;
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => ({
        ok: true,
        steps,
        source: 'smart',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1
      }),
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false,
      afterPersist: async () => {
        if (trip) {
          trip = false;
          engine.reset();
        }
      }
    });
    const aborted = await engine.run('balanced', false);
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.error).toMatch(/aborted/);
    }
    expect(engine.currentRevision()).toBeUndefined();
    expect(session.state).toBe('sealed');
    await expect(readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')).rejects.toThrow();
    expect(await nextRevision(session.dir)).toBe(1);

    const retry = await engine.run('balanced', false);
    expect(retry.ok).toBe(true);
    if (!retry.ok) {
      return;
    }
    expect(retry.revision.revision).toBe(1);
    expect(engine.currentRevision()?.revision).toBe(1);
    expect(session.state).toBe('reviewing');
  });

  it('discards rev-N.json when raw.jsonl mutates after persist (P3-1 hash-mismatch)', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const steps = refineFromRaw(session.events, 'balanced');
    const rawPath = join(session.dir, 'raw.jsonl');
    const originalRaw = await readFile(rawPath, 'utf8');
    let trip = true;
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => ({
        ok: true,
        steps,
        source: 'smart',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1
      }),
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false,
      afterPersist: async () => {
        if (trip) {
          trip = false;
          await writeFile(rawPath, `${originalRaw}\n`, 'utf8');
        }
      }
    });
    const mutated = await engine.run('balanced', false);
    expect(mutated.ok).toBe(false);
    if (!mutated.ok) {
      expect(mutated.error).toMatch(/raw\.jsonl mutated during refine/);
    }
    expect(engine.currentRevision()).toBeUndefined();
    expect(session.state).toBe('sealed');
    await expect(readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')).rejects.toThrow();
    expect(await nextRevision(session.dir)).toBe(1);

    const retry = await engine.run('balanced', false);
    expect(retry.ok).toBe(true);
    if (!retry.ok) {
      return;
    }
    expect(retry.revision.revision).toBe(1);
    expect(session.state).toBe('reviewing');
  });

  it('discards rev-N.json when catch runs after persist (P3-1 catch-path / !stillOwns)', async () => {
    const session = await makeSession([click('evt_000001', 1, 'https://app.example.test/a', 1)]);
    const steps = refineFromRaw(session.events, 'balanced');
    let trip = true;
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => ({
        ok: true,
        steps,
        source: 'smart',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1
      }),
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false,
      afterPersist: async () => {
        if (trip) {
          trip = false;
          engine.reset();
          throw new Error('boom after persist');
        }
      }
    });
    const crashed = await engine.run('balanced', false);
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) {
      expect(crashed.error).toMatch(/aborted|boom after persist/);
    }
    expect(engine.currentRevision()).toBeUndefined();
    expect(session.state).toBe('sealed');
    await expect(readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')).rejects.toThrow();
    expect(await nextRevision(session.dir)).toBe(1);

    const retry = await engine.run('balanced', false);
    expect(retry.ok).toBe(true);
    if (!retry.ok) {
      return;
    }
    expect(retry.revision.revision).toBe(1);
    expect(session.state).toBe('reviewing');
  });

  it('rejects sourceEvents that are retracted (LOT4-R4)', async () => {
    const events: RawEvent[] = [
      click('evt_000001', 1, 'https://app.example.test/a', 1),
      {
        schemaVersion: 1,
        id: 'evt_000002',
        sessionId: 'ses_lot4',
        ts: 2,
        kind: 'step.retracted',
        retracts: 'evt_000001'
      }
    ];
    const session = await makeSession(events);
    const leaked = refineFromRaw(
      [click('evt_000001', 1, 'https://app.example.test/a', 1)],
      'balanced'
    ).map((step) => ({ ...step, sourceEvents: ['evt_000001'] }));
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => ({
        ok: true,
        steps: leaked,
        source: 'smart',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1
      }),
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false
    });
    const result = await engine.run('balanced', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/traceable/);
    }
    expect(engine.currentRevision()).toBeUndefined();
    expect(session.state).toBe('sealed');
  });

  it('correlates observe() by selector and does not poison a later insufficient step (LOT4-R3c)', async () => {
    const first = weakCssStep(0, '#first-click', 'Je clique sur first');
    const later = weakCssStep(1, '#later-weak', 'Je clique sur later');
    const session = await makeSession([
      cssClick('evt_000001', 1, '#first-click'),
      cssClick('evt_000002', 2, '#later-weak')
    ]);
    const engine = new RefineEngine({
      session: () => session as unknown as SessionOrchestrator,
      refine: async () => ({
        ok: true,
        steps: [first, later],
        source: 'smart',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1
      }),
      model: () => 'claude-sonnet-4-5-20250929',
      confirmThreshold: () => 100_000,
      offline: () => false,
      observe: async () => ({
        ok: true,
        observations: [
          { selector: '#poison-other', description: 'unrelated widget' },
          { selector: '#later-weak', description: 'later control' },
          { selector: '#first-click', description: 'first control' }
        ]
      })
    });
    const result = await engine.run('balanced', false);
    expect(result.ok).toBe(true);
    const file = engine.currentRevision();
    expect(file).toBeDefined();
    const disk = JSON.parse(await readFile(join(session.dir, 'refined', 'rev-1.json'), 'utf8')) as {
      steps: RefinedStep[];
    };
    expect(JSON.stringify(disk)).not.toContain('#poison-other');
    expect(disk.steps[0]?.action.descriptor.selector).toBe('#first-click');
    expect(disk.steps[0]?.action.descriptor.fallbackSelectors).toEqual(['#first-click']);
    expect(disk.steps[1]?.action.descriptor.selector).toBe('#later-weak');
    expect(disk.steps[1]?.action.descriptor.fallbackSelectors).toEqual(['#later-weak']);
    expect(disk.steps[0]?.action.descriptor.fallbackSelectors).not.toEqual(
      disk.steps[1]?.action.descriptor.fallbackSelectors
    );
  });
});

describe('applyCorrelatedObserveEnrichment (LOT4-R3c)', () => {
  it('does not attach observations[0] to the first insufficient step (used++ poison)', () => {
    const later = weakCssStep(0, '#later-weak', 'Je clique sur later');
    const earlier = weakCssStep(1, '#first-click', 'Je clique sur first');
    const applied = applyCorrelatedObserveEnrichment(
      [later, earlier],
      [{ selector: '#first-click' }, { selector: '#later-weak' }]
    );
    expect(applied).toBe(2);
    expect(later.action.descriptor.fallbackSelectors).toEqual(['#later-weak']);
    expect(later.action.descriptor.fallbackSelectors).not.toContain('#first-click');
    expect(earlier.action.descriptor.fallbackSelectors).toEqual(['#first-click']);
    expect(earlier.action.descriptor.fallbackSelectors).not.toContain('#later-weak');
  });

  it('matches reverse-order observations and skips unmatched leftover selectors', () => {
    const first = weakCssStep(0, '#first-click', 'Je clique sur first');
    const later = weakCssStep(1, '#later-weak', 'Je clique sur later');
    const applied = applyCorrelatedObserveEnrichment(
      [first, later],
      [
        { selector: '#poison-other', description: 'noise' },
        { selector: '#later-weak' },
        { selector: '#first-click' }
      ]
    );
    expect(applied).toBe(2);
    expect(first.action.descriptor.fallbackSelectors).toEqual(['#first-click']);
    expect(later.action.descriptor.fallbackSelectors).toEqual(['#later-weak']);
    expect(JSON.stringify([first, later])).not.toContain('#poison-other');
  });

  it('leaves a step unenriched when no confident target match exists', () => {
    const empty = weakCssStep(0, '', 'Je clique sur inconnu');
    const later = weakCssStep(1, '#later-weak', 'Je clique sur later');
    const applied = applyCorrelatedObserveEnrichment(
      [empty, later],
      [{ selector: '#poison-other', description: 'noise' }, { selector: '#later-weak' }]
    );
    expect(applied).toBe(1);
    expect(empty.action.descriptor.fallbackSelectors).toBeUndefined();
    expect(later.action.descriptor.fallbackSelectors).toEqual(['#later-weak']);
  });

  it('does not write fallbackSelectors on a weak description substring (lien ⊆ lien vers accueil)', () => {
    const step: RefinedStep = {
      index: 0,
      intent: 'Je clique sur lien',
      action: {
        type: 'click',
        descriptor: {
          type: 'click',
          selector: '',
          selectorStrategy: 'css',
          description: 'lien'
        }
      },
      verification: {
        type: 'elementVisible',
        expected: '',
        strength: 'weak',
        weakReason: 'ambiguous-target',
        confirmedByUser: false
      },
      sourceEvents: ['evt_000001']
    };
    expect(
      observeMatchScore({ selector: '#accueil', description: 'lien vers accueil' }, step)
    ).toBe(0);
    const applied = applyCorrelatedObserveEnrichment(
      [step],
      [{ selector: '#accueil', description: 'lien vers accueil' }]
    );
    expect(applied).toBe(0);
    expect(step.action.descriptor.fallbackSelectors).toBeUndefined();
    expect(step.action.descriptor.selector).toBe('');
  });

  it('still attaches on exact selector or token-set-equal description', () => {
    const bySelector = weakCssStep(0, '#accueil', 'Je clique sur accueil');
    expect(
      observeMatchScore({ selector: '#accueil', description: 'autre texte' }, bySelector)
    ).toBe(100);
    const byDescription: RefinedStep = {
      ...weakCssStep(0, '', 'Je clique sur lien'),
      action: {
        type: 'click',
        descriptor: {
          type: 'click',
          selector: '',
          selectorStrategy: 'css',
          description: 'lien vers accueil'
        }
      }
    };
    expect(
      observeMatchScore({ selector: '#accueil', description: 'accueil lien vers' }, byDescription)
    ).toBe(40);
    const applied = applyCorrelatedObserveEnrichment(
      [byDescription],
      [{ selector: '#accueil', description: 'accueil lien vers' }]
    );
    expect(applied).toBe(1);
    expect(byDescription.action.descriptor.fallbackSelectors).toEqual(['#accueil']);
  });
});
