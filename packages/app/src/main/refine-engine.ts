import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawEvent, RefinedStep } from '@spyglass/contracts';
import { validateRefinedStep } from '@spyglass/contracts';
import {
  canFinalize,
  estimateRefineTokens,
  isReplayDescriptorSufficient,
  type RefineAggressiveness,
  type RefineTransportResult,
  SmartOperationBudget,
  sourceEventsAreTraceable,
  unconfirmedWeaks,
  weakGroup
} from '@spyglass/llm';
import type { RefinedStepView, RefineRevisionView, StagehandObservation } from '../shared/ipc.ts';
import { isLlmOffline } from './llm-transport.ts';
import type { SessionOrchestrator } from './session-orchestrator.ts';

export type RefinedRevisionFile = {
  schemaVersion: 1;
  sessionId: string;
  revision: number;
  createdAt: string;
  aggressiveness: RefineAggressiveness;
  model: string;
  status: 'reviewing' | 'finalized';
  observeEnrichment: boolean;
  estimatedTokens: number;
  actualTokens: number;
  source: 'smart' | 'fallback';
  steps: RefinedStep[];
};

export type RefineEngineDeps = {
  session: () => SessionOrchestrator;
  refine: (
    events: readonly RawEvent[],
    aggressiveness: RefineAggressiveness
  ) => Promise<RefineTransportResult>;
  model: () => string;
  confirmThreshold: () => number;
  offline: () => boolean;
  observe?: () => Promise<{ ok: boolean; observations: StagehandObservation[] }>;
};

export class RefineEngine {
  private current: RefinedRevisionFile | undefined;
  private readonly budget = new SmartOperationBudget();

  constructor(private readonly deps: RefineEngineDeps) {}

  configureThreshold(threshold: number): void {
    this.budget.configure(threshold);
  }

  currentRevision(): RefinedRevisionFile | undefined {
    return this.current;
  }

  view(): RefineRevisionView | undefined {
    if (this.current === undefined) {
      return undefined;
    }
    return toView(this.current);
  }

  async estimate(aggressiveness: RefineAggressiveness = 'balanced'): Promise<{
    ok: boolean;
    sessionId?: string;
    estimatedTokens: number;
    threshold: number;
    requiresConfirm: boolean;
    model: string;
    eventCount: number;
    error?: string;
  }> {
    const session = this.deps.session();
    const sessionId = session.currentSessionId();
    if (sessionId === undefined || !session.canRefine()) {
      return {
        ok: false,
        estimatedTokens: 0,
        threshold: this.deps.confirmThreshold(),
        requiresConfirm: false,
        model: this.deps.model(),
        eventCount: 0,
        error: 'session is not sealed'
      };
    }
    const events = await session.readRawEvents();
    this.budget.configure(this.deps.confirmThreshold());
    const estimatedTokens = estimateRefineTokens(events, aggressiveness);
    const snap = this.budget.estimate(estimatedTokens);
    return {
      ok: true,
      sessionId,
      estimatedTokens: snap.estimatedTokens,
      threshold: snap.threshold,
      requiresConfirm: snap.requiresConfirm,
      model: this.deps.model(),
      eventCount: events.length
    };
  }

  async run(
    aggressiveness: RefineAggressiveness = 'balanced',
    confirm = false
  ): Promise<
    | { ok: true; revision: RefineRevisionView }
    | { ok: false; error: string; needsConfirm?: boolean; estimatedTokens?: number }
  > {
    const session = this.deps.session();
    if (this.deps.offline() || isLlmOffline()) {
      return { ok: false, error: 'smart profile unreachable' };
    }
    if (!session.canRefine()) {
      return { ok: false, error: `cannot refine from ${session.snapshot().state}` };
    }
    const sessionDir = session.currentSessionDir();
    const sessionId = session.currentSessionId();
    if (sessionDir === undefined || sessionId === undefined) {
      return { ok: false, error: 'no sealed session' };
    }
    const events = await session.readRawEvents();
    const beforeHash = await rawFingerprint(sessionDir);
    this.budget.configure(this.deps.confirmThreshold());
    const estimatedTokens = estimateRefineTokens(events, aggressiveness);
    const gate = this.budget.assertConfirm(estimatedTokens, confirm);
    if ('error' in gate) {
      return {
        ok: false,
        error: gate.error,
        needsConfirm: true,
        estimatedTokens
      };
    }
    const hadRevision = this.current !== undefined;
    session.beginRefine();
    this.budget.beginOperation();
    try {
      const result = await this.deps.refine(events, aggressiveness);
      if (!result.ok) {
        session.abortRefine(hadRevision);
        return { ok: false, error: result.error };
      }
      this.budget.recordCall(result.inputTokens, result.outputTokens);
      const ids = new Set(events.map((event) => event.id));
      if (!sourceEventsAreTraceable(result.steps, ids)) {
        session.abortRefine(hadRevision);
        return { ok: false, error: 'sourceEvents are not traceable to raw.jsonl' };
      }
      const steps = result.steps.map((step, index) => ({ ...step, index }));
      const observeEnrichment = await this.maybeObserve(steps);
      const revision = await nextRevision(sessionDir);
      const file: RefinedRevisionFile = {
        schemaVersion: 1,
        sessionId,
        revision,
        createdAt: new Date().toISOString(),
        aggressiveness,
        model: this.deps.model(),
        status: 'reviewing',
        observeEnrichment,
        estimatedTokens,
        actualTokens: result.inputTokens + result.outputTokens,
        source: result.source,
        steps
      };
      await persistRevision(sessionDir, file);
      const afterHash = await rawFingerprint(sessionDir);
      if (afterHash !== beforeHash) {
        session.abortRefine(hadRevision);
        return { ok: false, error: 'raw.jsonl mutated during refine' };
      }
      this.current = file;
      session.finishRefineReview();
      return { ok: true, revision: toView(file) };
    } catch (error) {
      session.abortRefine(hadRevision);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async confirm(options: {
    routine?: boolean;
    index?: number;
  }): Promise<{ ok: true; revision: RefineRevisionView } | { ok: false; error: string }> {
    const file = this.current;
    const session = this.deps.session();
    if (file === undefined || session.snapshot().state !== 'reviewing') {
      return { ok: false, error: 'no revision to confirm' };
    }
    const sessionDir = session.currentSessionDir();
    if (sessionDir === undefined) {
      return { ok: false, error: 'no session directory' };
    }
    const before = await rawFingerprint(sessionDir);
    if (options.routine === true) {
      for (const step of file.steps) {
        if (
          step.verification.strength === 'weak' &&
          step.verification.weakReason === 'observable-state-change'
        ) {
          step.verification.confirmedByUser = true;
        }
      }
    } else if (typeof options.index === 'number') {
      const step = file.steps[options.index];
      if (step === undefined) {
        return { ok: false, error: 'unknown step' };
      }
      if (step.verification.strength !== 'weak') {
        return { ok: false, error: 'step is not weak' };
      }
      step.verification.confirmedByUser = true;
    } else {
      return { ok: false, error: 'specify routine or index' };
    }
    await persistRevision(sessionDir, file);
    if ((await rawFingerprint(sessionDir)) !== before) {
      return { ok: false, error: 'raw.jsonl mutated during confirm' };
    }
    this.current = file;
    return { ok: true, revision: toView(file) };
  }

  async edit(
    index: number,
    intent: string
  ): Promise<{ ok: true; revision: RefineRevisionView } | { ok: false; error: string }> {
    const file = this.current;
    const session = this.deps.session();
    if (file === undefined || session.snapshot().state !== 'reviewing') {
      return { ok: false, error: 'no revision to edit' };
    }
    const step = file.steps[index];
    if (step === undefined) {
      return { ok: false, error: 'unknown step' };
    }
    const next = intent.trim();
    if (next.length === 0) {
      return { ok: false, error: 'intent required' };
    }
    const sessionDir = session.currentSessionDir();
    if (sessionDir === undefined) {
      return { ok: false, error: 'no session directory' };
    }
    const before = await rawFingerprint(sessionDir);
    step.intent = next;
    await persistRevision(sessionDir, file);
    if ((await rawFingerprint(sessionDir)) !== before) {
      return { ok: false, error: 'raw.jsonl mutated during edit' };
    }
    this.current = file;
    return { ok: true, revision: toView(file) };
  }

  async finalize(): Promise<
    | { ok: true; revision: RefineRevisionView }
    | { ok: false; error: string; unconfirmedWeak?: number }
  > {
    const file = this.current;
    const session = this.deps.session();
    if (file === undefined || session.snapshot().state !== 'reviewing') {
      return { ok: false, error: 'no revision to finalize' };
    }
    const pending = unconfirmedWeaks(file.steps);
    if (pending.length > 0 || !canFinalize(file.steps)) {
      return {
        ok: false,
        error: 'unconfirmed weak',
        unconfirmedWeak: pending.length
      };
    }
    for (const step of file.steps) {
      const result = validateRefinedStep(step);
      if (!result.valid) {
        return { ok: false, error: 'refined step schema invalid' };
      }
    }
    const sessionDir = session.currentSessionDir();
    if (sessionDir === undefined) {
      return { ok: false, error: 'no session directory' };
    }
    const before = await rawFingerprint(sessionDir);
    file.status = 'finalized';
    await persistRevision(sessionDir, file);
    if ((await rawFingerprint(sessionDir)) !== before) {
      return { ok: false, error: 'raw.jsonl mutated during finalize' };
    }
    session.finalizeScenario();
    this.current = file;
    return { ok: true, revision: toView(file) };
  }

  reset(): void {
    this.current = undefined;
  }

  private async maybeObserve(steps: RefinedStep[]): Promise<boolean> {
    const insufficient = steps.filter(
      (step) => !isReplayDescriptorSufficient(step.action.descriptor)
    );
    if (insufficient.length === 0) {
      return false;
    }
    if (this.deps.observe === undefined) {
      return false;
    }
    const result = await this.deps.observe();
    if (!result.ok) {
      return false;
    }
    let used = 0;
    for (const step of insufficient) {
      const observation = result.observations[used];
      used += 1;
      if (observation === undefined) {
        break;
      }
      if (observation.description !== undefined && observation.description.length > 0) {
        step.action.descriptor.description = observation.description;
      }
      if (observation.selector !== undefined && observation.selector.length > 0) {
        const fallbacks = step.action.descriptor.fallbackSelectors ?? [];
        if (!fallbacks.includes(observation.selector)) {
          step.action.descriptor.fallbackSelectors = [...fallbacks, observation.selector];
        }
        step.action.fallbackSelectors = step.action.descriptor.fallbackSelectors;
      }
    }
    return true;
  }
}

export function toView(file: RefinedRevisionFile): RefineRevisionView {
  const steps = file.steps.map(toStepView);
  const pending = unconfirmedWeaks(file.steps);
  const routineUnconfirmed = pending.filter(
    (step) => weakGroup(step.verification.weakReason) === 'routine'
  ).length;
  const doubtfulUnconfirmed = pending.filter(
    (step) => weakGroup(step.verification.weakReason) === 'doubtful'
  ).length;
  return {
    sessionId: file.sessionId,
    revision: file.revision,
    status: file.status,
    aggressiveness: file.aggressiveness,
    model: file.model,
    observeEnrichment: file.observeEnrichment,
    estimatedTokens: file.estimatedTokens,
    actualTokens: file.actualTokens,
    source: file.source,
    steps,
    unconfirmedWeak: pending.length,
    routineUnconfirmed,
    doubtfulUnconfirmed,
    canFinalize: canFinalize(file.steps) && file.status !== 'finalized'
  };
}

export function toStepView(step: RefinedStep): RefinedStepView {
  const group = weakGroup(step.verification.weakReason);
  const view: RefinedStepView = {
    index: step.index,
    intent: step.intent,
    actionType: step.action.type,
    selector: step.action.descriptor.selector,
    verificationType: step.verification.type,
    expected: step.verification.expected,
    strength: step.verification.strength,
    confirmedByUser: step.verification.confirmedByUser,
    sourceEvents: [...step.sourceEvents]
  };
  if (step.verification.weakReason !== undefined) {
    view.weakReason = step.verification.weakReason;
  }
  if (group !== undefined) {
    view.weakGroup = group;
  }
  return view;
}

async function persistRevision(sessionDir: string, file: RefinedRevisionFile): Promise<void> {
  const dir = join(sessionDir, 'refined');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `rev-${String(file.revision)}.json`);
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

async function nextRevision(sessionDir: string): Promise<number> {
  const dir = join(sessionDir, 'refined');
  try {
    const names = await readdir(dir);
    let max = 0;
    for (const name of names) {
      const match = /^rev-(\d+)\.json$/u.exec(name);
      if (match?.[1] !== undefined) {
        max = Math.max(max, Number.parseInt(match[1], 10));
      }
    }
    return max + 1;
  } catch {
    return 1;
  }
}

async function rawFingerprint(sessionDir: string): Promise<string> {
  const path = join(sessionDir, 'raw.jsonl');
  return await readFile(path, 'utf8');
}
