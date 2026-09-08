import type { RawEvent, RefinedStep, ReplayDescriptor } from '@spyglass/contracts';
import { REFINE_SYSTEM_PROMPT } from './constants.ts';
import type { ExpurgatedEvent } from './expurgate.ts';
import { expurgateEvent, scrubText } from './expurgate.ts';

export type RefineAggressiveness = 'conservative' | 'balanced' | 'aggressive';

export type WeakGroup = 'routine' | 'doubtful';

export type LlmRefineProposal = {
  intent: string;
  actionType: ReplayDescriptor['type'];
  sourceEvents: string[];
  verification?: {
    type?: RefinedStep['verification']['type'];
    expected?: string;
    strength?: 'strong' | 'weak';
    weakReason?: NonNullable<RefinedStep['verification']['weakReason']>;
  };
};

export type ExpurgatedRefineEvent = ExpurgatedEvent & {
  stepIndex?: number;
  actionType?: ReplayDescriptor['type'];
  retracts?: string;
  voice?: {
    text?: string;
    relation?: string;
    correlatedEventId?: string;
    correlatedStepIndex?: number;
  };
};

const ACTION_KINDS = new Set([
  'dom.click',
  'dom.dblclick',
  'dom.input',
  'dom.change',
  'dom.check',
  'dom.select',
  'dom.submit',
  'dom.key',
  'dom.scroll',
  'nav.load',
  'nav.spa',
  'nav.redirect',
  'nav.back',
  'nav.forward'
]);

const NOISE_KINDS = new Set([
  'record.start',
  'record.pause',
  'record.resume',
  'record.stop',
  'agent.message',
  'agent.narration-mode',
  'user.message',
  'voice.partial',
  'net.request',
  'selection.text',
  'selection.value',
  'nav.popup-redirected'
]);

const STRONG_STRATEGIES = new Set(['testId', 'role+name', 'id']);

export function collectRetractedIds(events: readonly RawEvent[]): Set<string> {
  const retracted = new Set<string>();
  for (const event of events) {
    if (event.kind === 'step.retracted' && typeof event.retracts === 'string') {
      retracted.add(event.retracts);
    }
  }
  return retracted;
}

export function allowedRefineIds(events: readonly RawEvent[]): Set<string> {
  const retracted = collectRetractedIds(events);
  const ids = new Set<string>();
  for (const event of events) {
    if (retracted.has(event.id) || event.kind === 'step.retracted') {
      continue;
    }
    ids.add(event.id);
  }
  return ids;
}

export function expurgateForRefine(event: RawEvent): ExpurgatedRefineEvent {
  const clean: ExpurgatedRefineEvent = { ...expurgateEvent(event) };
  if (event.stepIndex !== undefined) {
    clean.stepIndex = event.stepIndex;
  }
  if (event.action?.type !== undefined) {
    clean.actionType = event.action.type;
  }
  if (typeof event.retracts === 'string') {
    clean.retracts = event.retracts;
  }
  if (event.voice !== undefined) {
    const voice: NonNullable<ExpurgatedRefineEvent['voice']> = {};
    const text = scrubText(event.voice.text);
    if (text !== undefined) {
      voice.text = text;
    }
    if (event.voice.relation !== undefined) {
      voice.relation = event.voice.relation;
    }
    if (event.voice.correlatedEventId !== undefined) {
      voice.correlatedEventId = event.voice.correlatedEventId;
    }
    if (event.voice.correlatedStepIndex !== undefined) {
      voice.correlatedStepIndex = event.voice.correlatedStepIndex;
    }
    if (Object.keys(voice).length > 0) {
      clean.voice = voice;
    }
  }
  return clean;
}

export function isReplayDescriptorSufficient(descriptor: ReplayDescriptor): boolean {
  if (descriptor.selector.trim().length === 0) {
    return false;
  }
  const strategy = descriptor.selectorStrategy;
  if (strategy !== undefined && STRONG_STRATEGIES.has(strategy)) {
    return true;
  }
  const description = descriptor.description?.trim() ?? '';
  const fallbacks = descriptor.fallbackSelectors ?? [];
  return description.length > 0 && fallbacks.length > 0;
}

export function weakGroup(
  reason: RefinedStep['verification']['weakReason'] | undefined
): WeakGroup | undefined {
  if (reason === 'observable-state-change') {
    return 'routine';
  }
  if (
    reason === 'no-observable-change' ||
    reason === 'ambiguous-target' ||
    reason === 'value-assertion'
  ) {
    return 'doubtful';
  }
  return undefined;
}

export function unconfirmedWeaks(steps: readonly RefinedStep[]): RefinedStep[] {
  return steps.filter(
    (step) => step.verification.strength === 'weak' && step.verification.confirmedByUser !== true
  );
}

export function canFinalize(steps: readonly RefinedStep[]): boolean {
  return (
    steps.length > 0 &&
    unconfirmedWeaks(steps).length === 0 &&
    steps.every((step) => step.verification !== undefined && step.sourceEvents.length > 0)
  );
}

export function sourceEventsAreTraceable(
  steps: readonly RefinedStep[],
  rawIds: ReadonlySet<string>
): boolean {
  for (const step of steps) {
    if (step.sourceEvents.length === 0) {
      return false;
    }
    for (const id of step.sourceEvents) {
      if (!rawIds.has(id)) {
        return false;
      }
    }
  }
  return true;
}

export function estimateRefineTokens(
  events: readonly RawEvent[],
  aggressiveness: RefineAggressiveness = 'balanced'
): number {
  const payload = buildRefineUserPayload(events, aggressiveness);
  const chars = REFINE_SYSTEM_PROMPT.length + payload.length;
  const outputReserve = Math.max(400, usableActionEvents(events).length * 180);
  return Math.ceil(chars / 4) + outputReserve;
}

export function buildRefineUserPayload(
  events: readonly RawEvent[],
  aggressiveness: RefineAggressiveness,
  locale = 'fr'
): string {
  const retracted = collectRetractedIds(events);
  const clean = events
    .filter((event) => !retracted.has(event.id) && event.kind !== 'step.retracted')
    .map(expurgateForRefine);
  return JSON.stringify({
    locale,
    task: 'refine',
    aggressiveness,
    events: clean
  });
}

export function buildRefineMessages(
  events: readonly RawEvent[],
  aggressiveness: RefineAggressiveness
): { system: string; user: string } {
  return {
    system: REFINE_SYSTEM_PROMPT,
    user: buildRefineUserPayload(events, aggressiveness)
  };
}

export function refineFromRaw(
  events: readonly RawEvent[],
  aggressiveness: RefineAggressiveness = 'balanced'
): RefinedStep[] {
  const groups = groupActionEvents(events, aggressiveness);
  return groups.map((group, index) => toRefinedStep(index, group, events));
}

export function parseRefineResponse(
  raw: string,
  allowedIds: ReadonlySet<string>
): { steps: LlmRefineProposal[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { error: 'invalid json' };
  }
  if (typeof parsed !== 'object' || parsed === null || !('steps' in parsed)) {
    return { error: 'missing steps' };
  }
  const rows = (parsed as { steps: unknown }).steps;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'steps is empty' };
  }
  const steps: LlmRefineProposal[] = [];
  for (const row of rows) {
    const proposal = asProposal(row, allowedIds);
    if (proposal === undefined) {
      return { error: 'invalid step' };
    }
    steps.push(proposal);
  }
  return { steps };
}

export function bindLlmProposal(
  proposals: readonly LlmRefineProposal[],
  events: readonly RawEvent[],
  aggressiveness: RefineAggressiveness = 'balanced'
): RefinedStep[] | { error: string } {
  const byId = indexEvents(events);
  const allowed = allowedRefineIds(events);
  const steps: RefinedStep[] = [];
  for (const [index, proposal] of proposals.entries()) {
    for (const id of proposal.sourceEvents) {
      if (!allowed.has(id)) {
        return { error: 'unknown sourceEvents' };
      }
    }
    const grouped = proposal.sourceEvents
      .map((id) => byId.get(id))
      .filter((event): event is RawEvent => event !== undefined);
    if (grouped.length === 0) {
      return { error: 'empty source group' };
    }
    const local = toRefinedStep(index, grouped, events);
    const intent = proposal.intent.trim();
    if (intent.length > 0) {
      local.intent = intent;
    }
    // Ignore model actionType. Local action + classifyVerification stay paired
    // (fill + valueEquals). Overlaying click onto a fill would leave rev-N.json
    // with a mismatched action/verification pair.
    // F-44 / ADR-0007: verification type, expected, and strength stay local.
    applyStrengthGuard(local, grouped, events);
    if (aggressiveness === 'aggressive' && local.verification.strength === 'weak') {
      // aggressiveness does not waive F-44 confirmation
      local.verification.confirmedByUser = false;
    }
    steps.push(local);
  }
  return steps;
}

export function mockRefineProposals(
  events: readonly ExpurgatedRefineEvent[],
  aggressiveness: RefineAggressiveness
): LlmRefineProposal[] {
  const retracted = new Set<string>();
  for (const event of events) {
    if (event.kind === 'step.retracted' && typeof event.retracts === 'string') {
      retracted.add(event.retracts);
    }
  }
  const actions = events.filter((event) => {
    if (retracted.has(event.id) || event.kind === 'step.retracted') {
      return false;
    }
    if (NOISE_KINDS.has(event.kind)) {
      return false;
    }
    if (event.kind === 'dom.scroll' && aggressiveness !== 'conservative') {
      return false;
    }
    if (event.kind.startsWith('nav.') && aggressiveness !== 'conservative') {
      return false;
    }
    return ACTION_KINDS.has(event.kind);
  });
  const merged = mergeExpurgated(actions, aggressiveness);
  return merged.map((group) => {
    const last = group[group.length - 1];
    const actionType = last?.actionType ?? actionTypeFromKind(last?.kind ?? 'dom.click');
    const name = refineLabel(last);
    return {
      intent: `Je ${intentVerb(actionType)} ${name}`,
      actionType,
      sourceEvents: group.map((event) => event.id)
    };
  });
}

function groupActionEvents(
  events: readonly RawEvent[],
  aggressiveness: RefineAggressiveness
): RawEvent[][] {
  const retracted = collectRetractedIds(events);
  const actions = events.filter((event) => {
    if (retracted.has(event.id) || event.kind === 'step.retracted') {
      return false;
    }
    if (NOISE_KINDS.has(event.kind) || event.kind.startsWith('voice.')) {
      return false;
    }
    if (event.kind === 'dom.scroll' && aggressiveness !== 'conservative') {
      return false;
    }
    if (event.kind.startsWith('nav.') && aggressiveness !== 'conservative') {
      return false;
    }
    return ACTION_KINDS.has(event.kind);
  });
  const groups: RawEvent[][] = [];
  for (const event of actions) {
    const previous = groups[groups.length - 1];
    if (
      previous !== undefined &&
      shouldMerge(previous[previous.length - 1], event, aggressiveness)
    ) {
      previous.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups;
}

function shouldMerge(
  previous: RawEvent | undefined,
  next: RawEvent,
  aggressiveness: RefineAggressiveness
): boolean {
  if (previous === undefined || aggressiveness === 'conservative') {
    return false;
  }
  const prevKey = mergeKey(previous);
  const nextKey = mergeKey(next);
  if (prevKey === undefined || nextKey === undefined || prevKey !== nextKey) {
    return false;
  }
  if (aggressiveness === 'balanced') {
    return previous.kind === next.kind;
  }
  return true;
}

function mergeKey(event: RawEvent): string | undefined {
  const selector = event.action?.selector ?? event.target?.testId ?? event.target?.id;
  if (selector === undefined || selector.length === 0) {
    return undefined;
  }
  return `${event.action?.type ?? event.kind}:${selector}`;
}

function toRefinedStep(index: number, group: RawEvent[], all: readonly RawEvent[]): RefinedStep {
  const primary = [...group].reverse().find((event) => event.action !== undefined) ?? group[0];
  if (primary === undefined) {
    throw new Error('empty refine group');
  }
  const descriptor = descriptorFromEvent(primary);
  const voices = correlatedVoices(group, all);
  const sourceEvents = uniqueIds([
    ...group.map((event) => event.id),
    ...voices.map((event) => event.id)
  ]);
  const intent = intentFrom(primary, voices);
  const following = eventsAfter(all, group[group.length - 1]?.ts ?? primary.ts);
  const verification = classifyVerification(primary, descriptor, following, voices);
  const step: RefinedStep = {
    index,
    intent,
    action: {
      type: descriptor.type,
      descriptor
    },
    verification,
    sourceEvents
  };
  const fallbacks = descriptor.fallbackSelectors;
  if (fallbacks !== undefined && fallbacks.length > 0) {
    step.action.fallbackSelectors = fallbacks;
  }
  return step;
}

function descriptorFromEvent(event: RawEvent): ReplayDescriptor {
  if (event.action !== undefined && event.action.selector.trim().length > 0) {
    return { ...event.action };
  }
  const type = actionTypeFromKind(event.kind);
  const selector =
    event.target?.testId !== undefined
      ? `[data-testid="${event.target.testId}"]`
      : event.target?.id !== undefined
        ? `#${event.target.id}`
        : event.page?.url !== undefined
          ? event.page.url
          : 'body';
  const descriptor: ReplayDescriptor = {
    type,
    selector,
    framePath: event.target?.framePath ?? ['main'],
    shadowPath: event.target?.shadowPath ?? []
  };
  if (event.target?.testId !== undefined) {
    descriptor.selectorStrategy = 'testId';
  } else if (event.target?.id !== undefined) {
    descriptor.selectorStrategy = 'id';
  } else if (type === 'navigate') {
    descriptor.selectorStrategy = 'css';
    descriptor.description = 'Navigation';
    descriptor.fallbackSelectors = [selector];
  } else {
    descriptor.selectorStrategy = 'css';
  }
  if (event.target?.accessibleName !== undefined) {
    descriptor.description = event.target.accessibleName;
  }
  return descriptor;
}

function classifyVerification(
  event: RawEvent,
  descriptor: ReplayDescriptor,
  following: readonly RawEvent[],
  voices: readonly RawEvent[]
): RefinedStep['verification'] {
  const nextNav = following.find(
    (candidate) =>
      candidate.kind.startsWith('nav.') &&
      candidate.page?.url !== undefined &&
      candidate.page.url !== event.page?.url
  );
  const hasVoice = voices.length > 0;
  const ambiguous =
    descriptor.selectorStrategy === 'css' || descriptor.selectorStrategy === 'xpath';
  const valueAction =
    descriptor.type === 'fill' || descriptor.type === 'select' || descriptor.type === 'check';

  if (nextNav?.page?.url !== undefined) {
    const expected = urlGlob(nextNav.page.url);
    if (hasVoice) {
      return {
        type: 'urlMatches',
        expected,
        strength: 'strong',
        confirmedByUser: true
      };
    }
    return {
      type: 'urlMatches',
      expected,
      strength: 'weak',
      weakReason: 'observable-state-change',
      confirmedByUser: false
    };
  }

  if (event.kind.startsWith('nav.') && event.page?.url !== undefined) {
    const expected = urlGlob(event.page.url);
    return {
      type: 'urlMatches',
      expected,
      strength: hasVoice ? 'strong' : 'weak',
      ...(hasVoice
        ? { confirmedByUser: true }
        : { weakReason: 'observable-state-change' as const, confirmedByUser: false })
    };
  }

  if (valueAction) {
    return {
      type: 'valueEquals',
      expected: hasVoice ? intentFrom(event, voices) : 'valeur saisie',
      strength: hasVoice ? 'strong' : 'weak',
      ...(hasVoice
        ? { confirmedByUser: true }
        : { weakReason: 'value-assertion' as const, confirmedByUser: false })
    };
  }

  if (ambiguous) {
    return {
      type: 'elementVisible',
      expected: descriptor.selector,
      strength: hasVoice ? 'strong' : 'weak',
      ...(hasVoice
        ? { confirmedByUser: true }
        : { weakReason: 'ambiguous-target' as const, confirmedByUser: false })
    };
  }

  return {
    type: 'elementVisible',
    expected: descriptor.selector,
    strength: hasVoice ? 'strong' : 'weak',
    ...(hasVoice
      ? { confirmedByUser: true }
      : { weakReason: 'no-observable-change' as const, confirmedByUser: false })
  };
}

function applyStrengthGuard(
  step: RefinedStep,
  group: readonly RawEvent[],
  all: readonly RawEvent[]
): void {
  const voices = correlatedVoices(group, all);
  if (step.verification.strength === 'strong' && voices.length === 0) {
    step.verification.strength = 'weak';
    step.verification.confirmedByUser = false;
    step.verification.weakReason =
      step.verification.weakReason ??
      (step.verification.type === 'valueEquals'
        ? 'value-assertion'
        : step.verification.type === 'urlMatches'
          ? 'observable-state-change'
          : 'no-observable-change');
  }
  if (step.verification.strength === 'strong') {
    step.verification.confirmedByUser = true;
    delete step.verification.weakReason;
  }
}

function correlatedVoices(group: readonly RawEvent[], all: readonly RawEvent[]): RawEvent[] {
  const ids = new Set(group.map((event) => event.id));
  const indexes = new Set(
    group.map((event) => event.stepIndex).filter((value): value is number => value !== undefined)
  );
  return all.filter((event) => {
    if (event.kind !== 'voice.final' && event.kind !== 'voice.edited') {
      return false;
    }
    const voice = event.voice;
    if (voice === undefined) {
      return false;
    }
    if (voice.correlatedEventId !== undefined && ids.has(voice.correlatedEventId)) {
      return true;
    }
    if (voice.correlatedStepIndex !== undefined && indexes.has(voice.correlatedStepIndex)) {
      return true;
    }
    return false;
  });
}

function intentFrom(event: RawEvent, voices: readonly RawEvent[]): string {
  const spoken = [...voices]
    .reverse()
    .map((row) => row.voice?.text?.trim())
    .find((text) => text !== undefined && text.length > 0);
  if (spoken !== undefined) {
    return spoken;
  }
  const gabarit = event.narration?.text?.trim();
  if (gabarit !== undefined && gabarit.length > 0) {
    return gabarit.replace(/^Tu as /u, "J'ai ").replace(/^Tu /u, 'Je ');
  }
  const type = event.action?.type ?? actionTypeFromKind(event.kind);
  const label =
    event.target?.accessibleName ??
    event.target?.testId ??
    event.target?.id ??
    event.target?.tag ??
    'élément';
  return `Je ${intentVerb(type)} ${label}`;
}

export function urlGlob(url: string): string {
  const lastSegment = (path: string): string | undefined =>
    path
      .split(/[/\\]/u)
      .filter((part) => part.length > 0 && part !== 'null')
      .at(-1);

  try {
    const parsed = new URL(url);
    const hostPath =
      parsed.protocol === 'file:' && (parsed.hostname === 'null' || parsed.hostname === '')
        ? parsed.pathname
        : parsed.pathname;
    const last = lastSegment(hostPath);
    if (last !== undefined) {
      return `**/${last}`;
    }
    return `**${parsed.pathname}`;
  } catch {
    const last = lastSegment(url);
    return last !== undefined ? `**/${last}` : url;
  }
}

function eventsAfter(events: readonly RawEvent[], ts: number): RawEvent[] {
  return events.filter((event) => event.ts > ts);
}

function refineLabel(event: ExpurgatedRefineEvent | undefined): string {
  const target = event?.target;
  return (
    target?.accessibleName ??
    target?.text ??
    target?.testId ??
    target?.name ??
    target?.id ??
    target?.tag ??
    'élément'
  );
}

function actionTypeFromKind(kind: string): ReplayDescriptor['type'] {
  switch (kind) {
    case 'dom.input':
    case 'dom.change':
      return 'fill';
    case 'dom.select':
      return 'select';
    case 'dom.check':
      return 'check';
    case 'dom.key':
      return 'press';
    case 'dom.scroll':
      return 'scroll';
    case 'nav.load':
    case 'nav.spa':
    case 'nav.redirect':
    case 'nav.back':
    case 'nav.forward':
      return 'navigate';
    default:
      return 'click';
  }
}

function intentVerb(type: ReplayDescriptor['type']): string {
  switch (type) {
    case 'fill':
      return 'remplis';
    case 'select':
      return 'choisis';
    case 'check':
      return 'coche';
    case 'press':
      return 'appuie sur';
    case 'navigate':
      return 'navigue vers';
    case 'scroll':
      return 'fais défiler';
    case 'wait':
      return 'attends';
    default:
      return 'clique sur';
  }
}

function usableActionEvents(events: readonly RawEvent[]): RawEvent[] {
  const retracted = collectRetractedIds(events);
  return events.filter(
    (event) =>
      !retracted.has(event.id) &&
      event.kind !== 'step.retracted' &&
      ACTION_KINDS.has(event.kind) &&
      !NOISE_KINDS.has(event.kind)
  );
}

function indexEvents(events: readonly RawEvent[]): Map<string, RawEvent> {
  const map = new Map<string, RawEvent>();
  for (const event of events) {
    map.set(event.id, event);
  }
  return map;
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function asProposal(row: unknown, allowedIds: ReadonlySet<string>): LlmRefineProposal | undefined {
  if (typeof row !== 'object' || row === null) {
    return undefined;
  }
  const record = row as {
    intent?: unknown;
    actionType?: unknown;
    sourceEvents?: unknown;
    verification?: unknown;
  };
  if (typeof record.intent !== 'string' || record.intent.trim().length === 0) {
    return undefined;
  }
  const actionType = asActionType(record.actionType);
  if (actionType === undefined) {
    return undefined;
  }
  if (!Array.isArray(record.sourceEvents) || record.sourceEvents.length === 0) {
    return undefined;
  }
  const sourceEvents: string[] = [];
  for (const id of record.sourceEvents) {
    if (typeof id !== 'string' || !id.startsWith('evt_') || !allowedIds.has(id)) {
      return undefined;
    }
    sourceEvents.push(id);
  }
  const proposal: LlmRefineProposal = {
    intent: record.intent.trim(),
    actionType,
    sourceEvents
  };
  if (typeof record.verification === 'object' && record.verification !== null) {
    const verification = record.verification as {
      type?: unknown;
      expected?: unknown;
      strength?: unknown;
      weakReason?: unknown;
    };
    proposal.verification = {};
    if (typeof verification.type === 'string') {
      proposal.verification.type = verification.type as RefinedStep['verification']['type'];
    }
    if (typeof verification.expected === 'string') {
      proposal.verification.expected = verification.expected;
    }
    if (verification.strength === 'strong' || verification.strength === 'weak') {
      proposal.verification.strength = verification.strength;
    }
    if (typeof verification.weakReason === 'string') {
      proposal.verification.weakReason = verification.weakReason as NonNullable<
        RefinedStep['verification']['weakReason']
      >;
    }
  }
  return proposal;
}

function asActionType(value: unknown): ReplayDescriptor['type'] | undefined {
  if (
    value === 'click' ||
    value === 'fill' ||
    value === 'select' ||
    value === 'check' ||
    value === 'press' ||
    value === 'navigate' ||
    value === 'wait' ||
    value === 'scroll'
  ) {
    return value;
  }
  return undefined;
}

function mergeExpurgated(
  events: readonly ExpurgatedRefineEvent[],
  aggressiveness: RefineAggressiveness
): ExpurgatedRefineEvent[][] {
  const groups: ExpurgatedRefineEvent[][] = [];
  for (const event of events) {
    const previous = groups[groups.length - 1];
    const last = previous?.[previous.length - 1];
    const same =
      last !== undefined &&
      aggressiveness !== 'conservative' &&
      last.kind === event.kind &&
      (last.target?.testId ?? last.target?.tag) === (event.target?.testId ?? event.target?.tag);
    if (same && previous !== undefined) {
      previous.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups;
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1] !== undefined) {
    return fenced[1];
  }
  return trimmed;
}
