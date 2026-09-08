import type { RawEvent, ReplayDescriptor } from '@spyglass/contracts';
import {
  expurgatePage,
  expurgateTarget,
  type FastTokenBudget,
  gabaritText,
  isEnrichableKind,
  type LlmGateway,
  type NarrateResult,
  SlidingBatcher,
  type UsageSnapshot
} from '@spyglass/llm';
import { shouldMaskField } from '@spyglass/probe';
import type { ChatEnrichedPayload, ChatMessagePayload, UsagePayload } from '../shared/ipc.ts';
import { formatBatchId } from './session-ids.ts';

const HAIKU_USD_PER_MTOK = { input: 1, output: 5 };

export type AgentAppend = {
  kind: RawEvent['kind'];
  narration?: RawEvent['narration'];
  retracts?: string;
};

export type ObserverHandlers = {
  emitChat: (message: ChatMessagePayload) => void;
  emitEnriched: (payload: ChatEnrichedPayload) => void;
  emitUsage: (usage: UsagePayload) => void;
  appendAgent: (event: AgentAppend) => Promise<void>;
};

export type ObserverDeps = {
  gateway: LlmGateway;
  budget: FastTokenBudget;
  windowMs: number;
  enrichmentEnabled: () => boolean;
  modelName: () => string;
  now?: () => number;
  persistCeiling?: (ceiling: number) => void | Promise<void>;
};

/**
 * Gabarit-first observer (F-21). Chat is painted locally; remote enrichment
 * is best-effort and never on the capture critical path.
 */
export class ObserverAgent {
  private batchSeq = 0;
  private announcedHalt: string | undefined;
  private readonly batcher: SlidingBatcher<RawEvent>;
  private readonly now: () => number;
  private sessionId: string | undefined;

  constructor(
    private readonly handlers: ObserverHandlers,
    private readonly deps: ObserverDeps
  ) {
    this.now = deps.now ?? Date.now;
    this.batcher = new SlidingBatcher<RawEvent>({
      windowMs: deps.windowMs,
      onFlush: (items) => this.enrich(items)
    });
  }

  onSessionStart(sessionId: string): void {
    this.sessionId = sessionId;
    this.batchSeq = 0;
    this.announcedHalt = undefined;
    this.deps.budget.resetSession();
    if (!this.deps.enrichmentEnabled() && this.deps.budget.snapshot().halt !== 'offline') {
      this.deps.budget.setHalt('disabled');
    }
    this.emitUsage();
    const halt = this.deps.budget.snapshot().halt;
    if (halt !== 'none') {
      this.announceHalt(this.deps.budget.snapshot());
    }
  }

  onRawEvent(event: RawEvent): void {
    if (event.kind === 'agent.message' || event.kind === 'agent.narration-mode') {
      return;
    }
    const issuedAt = this.now();
    const template = gabaritFor(event);
    const technical = technicalBlock(event);
    const message: ChatMessagePayload = {
      eventId: event.id,
      kind: event.kind,
      mode: 'template',
      text: template,
      issuedAt,
      retractable: event.kind.startsWith('dom.')
    };
    if (event.stepIndex !== undefined) {
      message.stepIndex = event.stepIndex;
    }
    if (technical !== undefined) {
      message.technical = technical;
    }
    this.handlers.emitChat(message);
    this.maybeEnqueue(event);
  }

  async flush(): Promise<void> {
    await this.batcher.flushNow();
  }

  raiseCeiling(tokens?: number): UsagePayload {
    const snapshot = this.deps.budget.raiseCeiling(tokens);
    this.announcedHalt = undefined;
    const payload = toUsagePayload(snapshot, this.deps.modelName());
    this.handlers.emitUsage(payload);
    this.emitResume();
    void this.deps.persistCeiling?.(snapshot.ceiling);
    return payload;
  }

  configureBudget(options: {
    ceiling?: number;
    warnRatio?: number;
    rateLimitPerMin?: number;
  }): UsagePayload {
    const previousHalt = this.deps.budget.snapshot().halt;
    const snapshot = this.deps.budget.configure(options);
    if (previousHalt === 'ceiling' && snapshot.halt === 'none') {
      this.announcedHalt = undefined;
      this.emitResume();
    } else if (snapshot.halt === 'ceiling' && previousHalt !== 'ceiling') {
      this.announceHalt(snapshot);
    }
    const payload = toUsagePayload(snapshot, this.deps.modelName());
    this.handlers.emitUsage(payload);
    return payload;
  }

  setEnabled(enabled: boolean): void {
    const halt = this.deps.budget.snapshot().halt;
    if (!enabled) {
      if (halt !== 'offline') {
        this.deps.budget.setHalt('disabled');
      }
      this.emitUsage();
      return;
    }
    if (halt === 'offline') {
      this.emitUsage();
      return;
    }
    if (halt === 'disabled' || halt === 'error') {
      this.deps.budget.setHalt('none');
    }
    this.announcedHalt = undefined;
    this.emitUsage();
  }

  setOffline(offline: boolean): void {
    if (offline) {
      this.deps.budget.setHalt('offline');
    } else if (this.deps.budget.snapshot().halt === 'offline') {
      this.deps.budget.setHalt('none');
      this.announcedHalt = undefined;
    }
    this.emitUsage();
  }

  dispose(): void {
    this.batcher.dispose();
  }

  private maybeEnqueue(event: RawEvent): void {
    if (!isEnrichableKind(event.kind)) {
      return;
    }
    const decision = this.deps.budget.decide();
    this.reconcileAnnouncedHalt(decision.snapshot);
    this.handlers.emitUsage(toUsagePayload(decision.snapshot, this.deps.modelName()));
    if (decision.decision === 'warn') {
      this.emitWarning(decision.snapshot);
    }
    if (decision.decision === 'halt') {
      this.announceHalt(decision.snapshot);
      return;
    }
    this.batcher.push(event);
  }

  private async enrich(events: RawEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const decision = this.deps.budget.decide();
    this.reconcileAnnouncedHalt(decision.snapshot);
    if (decision.decision === 'halt') {
      this.announceHalt(decision.snapshot);
      return;
    }
    this.batchSeq += 1;
    const batchId = formatBatchId(this.batchSeq);
    const result: NarrateResult = await this.deps.gateway.narrate(events);
    if (!result.ok) {
      this.deps.budget.setHalt('error');
      this.announceHalt(this.deps.budget.snapshot(), result.error);
      return;
    }
    const snapshot = this.deps.budget.recordCall(result.inputTokens, result.outputTokens);
    this.handlers.emitUsage(toUsagePayload(snapshot, this.deps.modelName()));
    if (snapshot.halt === 'none' && snapshot.ratio >= snapshot.warnRatio && !snapshot.warned) {
      this.deps.budget.markWarned();
      this.emitWarning(snapshot);
    }
    if (snapshot.halt === 'ceiling') {
      this.announceHalt(snapshot);
    }
    for (const item of result.narrations) {
      this.handlers.emitEnriched({ eventId: item.id, mode: 'llm', text: item.text });
      await this.appendNarration(item.id, item.text, batchId);
    }
  }

  private emitResume(): void {
    this.handlers.emitChat(
      systemMessage(this.now(), "Plafond relevé — l'enrichissement reprend.", 'warning')
    );
  }

  private emitWarning(snapshot: UsageSnapshot): void {
    this.handlers.emitChat(
      systemMessage(
        this.now(),
        `Attention : ${pct(snapshot.ratio)} % du plafond de tokens du profil fast est consommé.`,
        'warning',
        true
      )
    );
  }

  private announceHalt(snapshot: UsageSnapshot, detail?: string): void {
    if (this.announcedHalt === snapshot.halt) {
      return;
    }
    this.announcedHalt = snapshot.halt;
    const text = haltMessage(snapshot, detail);
    this.handlers.emitChat(
      systemMessage(
        this.now(),
        text,
        snapshot.halt === 'ceiling' ? 'danger' : 'degraded',
        snapshot.halt === 'ceiling'
      )
    );
    void this.appendMode(snapshot.halt, text);
  }

  private reconcileAnnouncedHalt(snapshot: UsageSnapshot): void {
    if (this.announcedHalt !== undefined && snapshot.halt !== this.announcedHalt) {
      this.announcedHalt = undefined;
    }
  }

  private async appendNarration(sourceId: string, text: string, batchId: string): Promise<void> {
    await this.handlers.appendAgent({
      kind: 'agent.message',
      narration: { mode: 'llm', batchId, text },
      retracts: sourceId
    });
  }

  private async appendMode(halt: string, text: string): Promise<void> {
    if (this.sessionId === undefined) {
      return;
    }
    await this.handlers.appendAgent({
      kind: 'agent.narration-mode',
      narration: { mode: halt === 'none' ? 'llm' : 'template', text }
    });
  }

  private emitUsage(): void {
    this.handlers.emitUsage(toUsagePayload(this.deps.budget.snapshot(), this.deps.modelName()));
  }
}

export function gabaritFor(event: RawEvent): string {
  if (event.narration?.text !== undefined && event.narration.text.length > 0) {
    return event.narration.text;
  }
  const input: Parameters<typeof gabaritText>[0] = { kind: event.kind };
  if (event.target !== undefined) {
    input.target = event.target;
  }
  if (event.value !== undefined) {
    input.value = event.value;
  }
  if (event.page !== undefined) {
    input.page = event.page;
  }
  const key = event.action?.arguments?.[0];
  if (typeof key === 'string' && event.value?.masked !== true) {
    input.key = key;
  }
  if (event.voice !== undefined) {
    const voice: { text?: string; relation?: NonNullable<RawEvent['voice']>['relation'] } = {};
    if (event.voice.text !== undefined) {
      voice.text = event.voice.text;
    }
    if (event.voice.relation !== undefined) {
      voice.relation = event.voice.relation;
    }
    input.voice = voice;
  }
  return gabaritText(input);
}

export function technicalBlock(event: RawEvent): string | undefined {
  const dropValues = shouldDropTechnicalValues(event);
  const page = expurgatePage(event.page);
  const target = expurgateTarget(event.target, dropValues);
  const action = redactTechnicalAction(event.action, dropValues);
  return JSON.stringify(
    {
      kind: event.kind,
      id: event.id,
      stepIndex: event.stepIndex,
      page,
      target,
      action,
      voice: event.voice
    },
    null,
    2
  );
}

function shouldDropTechnicalValues(event: RawEvent): boolean {
  if (event.value?.masked === true) {
    return true;
  }
  if (
    event.kind === 'dom.input' ||
    event.kind === 'dom.change' ||
    event.kind === 'dom.select' ||
    event.kind === 'dom.key'
  ) {
    return true;
  }
  return shouldMaskField({ name: event.target?.name });
}

function redactTechnicalAction(
  action: ReplayDescriptor | undefined,
  dropArgs: boolean
): ReplayDescriptor | undefined {
  if (action === undefined) {
    return undefined;
  }
  const redacted: ReplayDescriptor = {
    type: action.type,
    selector: action.selector
  };
  if (action.selectorStrategy !== undefined) {
    redacted.selectorStrategy = action.selectorStrategy;
  }
  if (action.framePath !== undefined) {
    redacted.framePath = action.framePath;
  }
  if (action.shadowPath !== undefined) {
    redacted.shadowPath = action.shadowPath;
  }
  if (!dropArgs && action.arguments !== undefined) {
    redacted.arguments = action.arguments;
  }
  return redacted;
}

export function toUsagePayload(snapshot: UsageSnapshot, model: string): UsagePayload {
  const payload: UsagePayload = {
    profile: snapshot.profile,
    calls: snapshot.calls,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    totalTokens: snapshot.totalTokens,
    ceiling: snapshot.ceiling,
    ratio: snapshot.ratio,
    halt: snapshot.halt
  };
  const usd = estimateUsd(model, snapshot.inputTokens, snapshot.outputTokens);
  if (usd !== undefined) {
    payload.estimatedUsd = usd;
  }
  return payload;
}

function systemMessage(
  issuedAt: number,
  text: string,
  banner: 'degraded' | 'warning' | 'danger',
  raise = false
): ChatMessagePayload {
  const message: ChatMessagePayload = {
    eventId: `sys_${banner}_${String(issuedAt)}`,
    kind: 'agent.narration-mode',
    mode: 'system',
    text,
    issuedAt,
    retractable: false,
    banner
  };
  if (raise) {
    message.actions = [{ id: 'raise-ceiling', label: 'Relever le plafond' }];
  }
  return message;
}

function estimateUsd(model: string, input: number, output: number): number | undefined {
  if (model !== 'claude-haiku-4-5-20251001' && model !== 'claude-haiku-4-5') {
    return undefined;
  }
  return (input * HAIKU_USD_PER_MTOK.input + output * HAIKU_USD_PER_MTOK.output) / 1_000_000;
}

function haltMessage(snapshot: UsageSnapshot, detail?: string): string {
  switch (snapshot.halt) {
    case 'ceiling':
      return "Plafond de tokens atteint — enrichissement suspendu. L'enregistrement continue.";
    case 'rate-limit':
      return `Seuil de débit atteint (${String(snapshot.rateLimitPerMin)} appels/min) — enrichissement suspendu. L'enregistrement continue.`;
    case 'offline':
      return "Réseau indisponible — le chat reste en gabarits déterministes. Aucun événement n'est perdu.";
    case 'disabled':
      return 'Enrichissement désactivé — narration par gabarits déterministes.';
    case 'error':
      return `Fournisseur injoignable — gabarits conservés.${detail !== undefined ? ` ${detail}` : ''}`;
    default:
      return "Enrichissement suspendu. L'enregistrement continue.";
  }
}

function pct(ratio: number): string {
  return String(Math.round(ratio * 100));
}
