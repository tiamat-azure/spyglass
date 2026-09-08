import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawEvent, RefinedStep } from '@spyglass/contracts';
import { validateRefinedStep } from '@spyglass/contracts';
import {
  allowedRefineIds,
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

const MIN_OBSERVE_DESCRIPTION = 3;

export function normalizeObserveSelector(selector: string): string {
  return selector.trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function stableObserveKeys(selector: string): Set<string> {
  const keys = new Set<string>();
  const add = (kind: string, value: string | undefined): void => {
    const token = value?.trim();
    if (token !== undefined && token.length > 0) {
      keys.add(`${kind}:${token.toLowerCase()}`);
    }
  };
  const raw = selector.trim();
  for (const match of raw.matchAll(/\[data-testid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))\]/giu)) {
    add('testid', match[1] ?? match[2] ?? match[3]);
  }
  for (const match of raw.matchAll(/\[id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))\]/giu)) {
    add('id', match[1] ?? match[2] ?? match[3]);
  }
  for (const match of raw.matchAll(/#([A-Za-z][\w:-]*)/gu)) {
    add('id', match[1]);
  }
  return keys;
}

export function observeMatchScore(observation: StagehandObservation, step: RefinedStep): number {
  const obsSel = observation.selector?.trim() ?? '';
  const candidates = [
    step.action.descriptor.selector,
    ...(step.action.descriptor.fallbackSelectors ?? [])
  ].filter((value) => value.trim().length > 0);
  if (obsSel.length > 0) {
    const obsNorm = normalizeObserveSelector(obsSel);
    if (candidates.some((candidate) => normalizeObserveSelector(candidate) === obsNorm)) {
      return 100;
    }
    const obsKeys = stableObserveKeys(obsSel);
    if (obsKeys.size > 0) {
      for (const candidate of candidates) {
        const stepKeys = stableObserveKeys(candidate);
        for (const key of obsKeys) {
          if (stepKeys.has(key)) {
            return 80;
          }
        }
      }
    }
  }
  const obsDesc = observation.description?.trim().toLowerCase() ?? '';
  const stepDesc = step.action.descriptor.description?.trim().toLowerCase() ?? '';
  if (
    obsDesc.length >= MIN_OBSERVE_DESCRIPTION &&
    stepDesc.length >= MIN_OBSERVE_DESCRIPTION &&
    (obsDesc === stepDesc || obsDesc.includes(stepDesc) || stepDesc.includes(obsDesc))
  ) {
    return 50;
  }
  return 0;
}

/** LOT4-R3c: attach Stagehand observations only when they correlate to a step. */
export function applyCorrelatedObserveEnrichment(
  steps: readonly RefinedStep[],
  observations: readonly StagehandObservation[]
): number {
  const insufficient = steps.filter(
    (step) => !isReplayDescriptorSufficient(step.action.descriptor)
  );
  const pairs: Array<{ step: RefinedStep; obsIndex: number; score: number }> = [];
  for (const step of insufficient) {
    for (const [obsIndex, observation] of observations.entries()) {
      const score = observeMatchScore(observation, step);
      if (score > 0) {
        pairs.push({ step, obsIndex, score });
      }
    }
  }
  pairs.sort((left, right) => right.score - left.score);
  const usedSteps = new Set<RefinedStep>();
  const usedObs = new Set<number>();
  const skippedObs = new Set<number>();
  let applied = 0;
  for (const pair of pairs) {
    if (usedSteps.has(pair.step) || usedObs.has(pair.obsIndex) || skippedObs.has(pair.obsIndex)) {
      continue;
    }
    const tied = pairs.filter(
      (candidate) =>
        candidate.obsIndex === pair.obsIndex &&
        candidate.score === pair.score &&
        !usedSteps.has(candidate.step)
    );
    if (tied.length > 1) {
      skippedObs.add(pair.obsIndex);
      continue;
    }
    const observation = observations[pair.obsIndex];
    if (observation === undefined) {
      continue;
    }
    applyMatchedObservation(pair.step, observation);
    usedSteps.add(pair.step);
    usedObs.add(pair.obsIndex);
    applied += 1;
  }
  return applied;
}

function applyMatchedObservation(step: RefinedStep, observation: StagehandObservation): void {
  const description = observation.description?.trim();
  if (description !== undefined && description.length > 0) {
    step.action.descriptor.description = description;
  }
  const selector = observation.selector?.trim() ?? '';
  if (selector.length === 0) {
    return;
  }
  const fallbacks = step.action.descriptor.fallbackSelectors ?? [];
  const already = fallbacks.some(
    (item) => normalizeObserveSelector(item) === normalizeObserveSelector(selector)
  );
  if (!already) {
    step.action.descriptor.fallbackSelectors = [...fallbacks, selector];
  }
  step.action.fallbackSelectors = step.action.descriptor.fallbackSelectors;
}

export class RefineEngine {
  private current: RefinedRevisionFile | undefined;
  private readonly budget = new SmartOperationBudget();
  private runToken = 0;

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
    const hadRevision = this.current !== undefined && this.current.sessionId === sessionId;
    session.beginRefine();
    const token = ++this.runToken;
    this.budget.beginOperation();
    try {
      const result = await this.deps.refine(events, aggressiveness);
      if (!this.stillOwns(token, sessionId)) {
        return this.abandonStale(sessionId, hadRevision);
      }
      if (!result.ok) {
        session.abortRefine(hadRevision);
        return { ok: false, error: result.error };
      }
      this.budget.recordCall(result.inputTokens, result.outputTokens);
      const allowed = allowedRefineIds(events);
      if (!sourceEventsAreTraceable(result.steps, allowed)) {
        session.abortRefine(hadRevision);
        return { ok: false, error: 'sourceEvents are not traceable to raw.jsonl' };
      }
      const steps = result.steps.map((step, index) => ({ ...step, index }));
      const observeEnrichment = await this.maybeObserve(steps);
      if (!this.stillOwns(token, sessionId)) {
        return this.abandonStale(sessionId, hadRevision);
      }
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
      if (!this.stillOwns(token, sessionId)) {
        return this.abandonStale(sessionId, hadRevision);
      }
      const afterHash = await rawFingerprint(sessionDir);
      if (afterHash !== beforeHash) {
        session.abortRefine(hadRevision);
        return { ok: false, error: 'raw.jsonl mutated during refine' };
      }
      this.current = file;
      session.finishRefineReview();
      return { ok: true, revision: toView(file) };
    } catch (error) {
      if (!this.stillOwns(token, sessionId)) {
        return this.abandonStale(sessionId, hadRevision);
      }
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
    this.runToken += 1;
    this.current = undefined;
  }

  private stillOwns(token: number, sessionId: string): boolean {
    return this.runToken === token && this.deps.session().currentSessionId() === sessionId;
  }

  private abandonStale(sessionId: string, hadRevision: boolean): { ok: false; error: string } {
    const session = this.deps.session();
    if (session.currentSessionId() === sessionId) {
      session.abortRefine(hadRevision);
    }
    if (this.current?.sessionId !== session.currentSessionId()) {
      this.current = undefined;
    }
    return { ok: false, error: 'refine aborted' };
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
    applyCorrelatedObserveEnrichment(steps, result.observations);
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
