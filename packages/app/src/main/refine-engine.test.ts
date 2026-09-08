import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawEvent, RefinedStep } from '@spyglass/contracts';
import { canFinalize, createMockTransport, LlmGateway, refineFromRaw } from '@spyglass/llm';
import { describe, expect, it } from 'vitest';
import { RefineEngine } from './refine-engine.ts';
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

async function makeSession(events: RawEvent[]): Promise<FakeSession> {
  const dir = await mkdtemp(join(tmpdir(), 'spyglass-refine-'));
  const sessionDir = join(dir, 'ses_lot4');
  await mkdir(sessionDir, { recursive: true });
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
    observe: options?.observe
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
});
