import type { RefinedStep, ReplayDescriptor, Scenario } from '@spyglass/contracts';
import { RECOVER_SYSTEM_PROMPT } from './constants.ts';
import {
  assertNoLeak,
  redactUrl,
  scrubText,
  secretLikeTokens,
  sensitiveQueryValues
} from './expurgate.ts';

export type RecoveryPromptInput = {
  scenario: Scenario;
  step: RefinedStep;
  error: string;
  attempt: number;
  beforeDom?: unknown;
  afterDom?: unknown;
  screenshotIncluded: boolean;
};

export type RecoveryPatchProposal = {
  diagnosis: string;
  patch: {
    scope: 'action.descriptor';
    descriptor: ReplayDescriptor;
  };
  confidence: number;
};

const PATCH_SCOPE = 'action.descriptor' as const;

export function buildRecoverUserPayload(input: RecoveryPromptInput): string {
  const steps = input.scenario.steps.map((step) => ({
    index: step.index,
    intent: scrubText(step.intent) ?? step.intent,
    actionType: step.action.type,
    selector: step.action.descriptor.selector,
    description: step.action.descriptor.description,
    verificationType: step.verification.type
  }));
  const payload = {
    task: 'recover',
    locale: 'fr',
    sessionId: input.scenario.sessionId,
    attempt: input.attempt,
    failedStep: {
      index: input.step.index,
      intent: scrubText(input.step.intent) ?? input.step.intent,
      actionType: input.step.action.type,
      selector: input.step.action.descriptor.selector,
      description: input.step.action.descriptor.description,
      fallbackSelectors: input.step.action.descriptor.fallbackSelectors ?? [],
      verification: {
        type: input.step.verification.type,
        expected: scrubText(input.step.verification.expected) ?? input.step.verification.expected
      }
    },
    error: scrubText(input.error) ?? input.error,
    startUrl: redactUrl(input.scenario.startUrl),
    steps,
    beforeDom: summarizeDom(input.beforeDom),
    afterDom: summarizeDom(input.afterDom),
    screenshotIncluded: input.screenshotIncluded
  };
  return JSON.stringify(payload);
}

export function buildRecoverMessages(input: RecoveryPromptInput): { system: string; user: string } {
  return {
    system: RECOVER_SYSTEM_PROMPT,
    user: buildRecoverUserPayload(input)
  };
}

export function parseRecoverResponse(text: string): RecoveryPatchProposal | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    return { error: 'recover response is not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'recover response is not an object' };
  }
  const record = parsed as Record<string, unknown>;
  const diagnosis = typeof record.diagnosis === 'string' ? record.diagnosis.trim() : '';
  if (diagnosis.length === 0) {
    return { error: 'missing diagnosis' };
  }
  const patch = record.patch;
  if (typeof patch !== 'object' || patch === null) {
    return { error: 'missing patch' };
  }
  const patchRecord = patch as Record<string, unknown>;
  if (patchRecord.scope !== PATCH_SCOPE) {
    return { error: 'rejected patch scope (F-62 invariant: action.descriptor only)' };
  }
  const descriptor = asReplayDescriptor(patchRecord.descriptor);
  if (descriptor === undefined) {
    return { error: 'invalid patch descriptor' };
  }
  const confidenceRaw = record.confidence;
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : 0;
  return {
    diagnosis,
    patch: { scope: PATCH_SCOPE, descriptor },
    confidence
  };
}

export function mockRecoverProposal(
  input: RecoveryPromptInput,
  overrideSelector?: string
): RecoveryPatchProposal {
  const selector =
    overrideSelector?.trim() ||
    input.step.action.descriptor.fallbackSelectors?.[0] ||
    input.step.action.descriptor.selector;
  return {
    diagnosis: 'Sélecteur mis à jour d’après l’intention et l’état DOM (mock smart).',
    patch: {
      scope: PATCH_SCOPE,
      descriptor: {
        ...input.step.action.descriptor,
        selector,
        type: input.step.action.type
      }
    },
    confidence: 0.8
  };
}

export function assertRecoverPayloadClean(payload: unknown, forbidden: readonly string[]): void {
  assertNoLeak(payload, forbidden);
}

export function recoverForbiddenTokens(input: RecoveryPromptInput): string[] {
  const tokens = new Set<string>();
  const add = (value: string | undefined): void => {
    const token = value?.trim();
    if (token !== undefined && token.length >= 4) {
      tokens.add(token);
    }
  };
  // Public startUrl hosts are not secrets (they remain in the redacted payload).
  for (const match of secretLikeTokens(input.error)) {
    add(match);
  }
  for (const match of secretLikeTokens(input.scenario.startUrl)) {
    add(match);
  }
  for (const match of sensitiveQueryValues(input.error)) {
    add(match);
  }
  for (const match of sensitiveQueryValues(input.scenario.startUrl)) {
    add(match);
  }
  return [...tokens];
}

function asReplayDescriptor(value: unknown): ReplayDescriptor | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  const selector = record.selector;
  if (!isActionType(type) || typeof selector !== 'string' || selector.trim().length === 0) {
    return undefined;
  }
  const descriptor: ReplayDescriptor = { type, selector };
  if (typeof record.selectorStrategy === 'string') {
    const strategy = record.selectorStrategy;
    if (
      strategy === 'testId' ||
      strategy === 'role+name' ||
      strategy === 'id' ||
      strategy === 'text' ||
      strategy === 'css' ||
      strategy === 'xpath'
    ) {
      descriptor.selectorStrategy = strategy;
    }
  }
  if (typeof record.description === 'string' && record.description.trim().length > 0) {
    descriptor.description = record.description.trim();
  }
  if (
    Array.isArray(record.fallbackSelectors) &&
    record.fallbackSelectors.every((item) => typeof item === 'string')
  ) {
    descriptor.fallbackSelectors = record.fallbackSelectors;
  }
  if (
    Array.isArray(record.arguments) &&
    record.arguments.every((item) => typeof item === 'string')
  ) {
    descriptor.arguments = record.arguments;
  }
  if (
    Array.isArray(record.framePath) &&
    record.framePath.every((item) => typeof item === 'string')
  ) {
    descriptor.framePath = record.framePath;
  }
  if (
    Array.isArray(record.shadowPath) &&
    record.shadowPath.every((item) => typeof item === 'string')
  ) {
    descriptor.shadowPath = record.shadowPath;
  }
  return descriptor;
}

function isActionType(value: unknown): value is ReplayDescriptor['type'] {
  return (
    value === 'click' ||
    value === 'fill' ||
    value === 'select' ||
    value === 'check' ||
    value === 'press' ||
    value === 'navigate' ||
    value === 'wait' ||
    value === 'scroll'
  );
}

function summarizeDom(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const scrubbed = scrubText(raw) ?? raw;
  return scrubbed.length > 4000 ? `${scrubbed.slice(0, 4000)}…` : scrubbed;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}
