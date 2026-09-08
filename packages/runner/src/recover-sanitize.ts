import type { ReplayDescriptor } from '@spyglass/contracts';
import { normalizeHttpOrHttpsUrl } from '@spyglass/llm';

/**
 * L5-ADV-01: recovered descriptors are not executed as unconstrained LLM output.
 * Type is pinned to the failed step. Fill/select/check/press/wait/scroll arguments
 * stay the recorded values. Navigate URLs must pass the chrome http(s) gate.
 */
export function sanitizeRecoveredDescriptor(
  original: ReplayDescriptor,
  proposed: ReplayDescriptor
): ReplayDescriptor {
  const type = original.type;
  const selector =
    type === 'navigate'
      ? original.selector
      : proposed.selector.trim().length > 0
        ? proposed.selector.trim()
        : original.selector;
  const sanitized: ReplayDescriptor = { type, selector };
  copyMeta(original, proposed, sanitized);
  applyArguments(type, original, proposed, sanitized);
  return sanitized;
}

function copyMeta(
  original: ReplayDescriptor,
  proposed: ReplayDescriptor,
  target: ReplayDescriptor
): void {
  const strategy = proposed.selectorStrategy ?? original.selectorStrategy;
  if (strategy !== undefined) {
    target.selectorStrategy = strategy;
  }
  const description = proposed.description ?? original.description;
  if (description !== undefined) {
    target.description = description;
  }
  const fallbacks = proposed.fallbackSelectors ?? original.fallbackSelectors;
  if (fallbacks !== undefined) {
    target.fallbackSelectors = fallbacks;
  }
  const framePath = proposed.framePath ?? original.framePath;
  if (framePath !== undefined) {
    target.framePath = framePath;
  }
  const shadowPath = proposed.shadowPath ?? original.shadowPath;
  if (shadowPath !== undefined) {
    target.shadowPath = shadowPath;
  }
}

function applyArguments(
  type: ReplayDescriptor['type'],
  original: ReplayDescriptor,
  proposed: ReplayDescriptor,
  target: ReplayDescriptor
): void {
  if (type === 'navigate') {
    const candidate = proposed.arguments?.[0] ?? proposed.selector;
    const gated = normalizeHttpOrHttpsUrl(candidate);
    if (gated !== undefined) {
      target.arguments = [gated];
      target.selector = gated;
      return;
    }
    target.selector = original.selector;
    copyOriginalArguments(original, target);
    return;
  }
  if (
    type === 'fill' ||
    type === 'select' ||
    type === 'check' ||
    type === 'press' ||
    type === 'wait' ||
    type === 'scroll'
  ) {
    copyOriginalArguments(original, target);
  }
}

function copyOriginalArguments(original: ReplayDescriptor, target: ReplayDescriptor): void {
  if (original.arguments !== undefined) {
    target.arguments = [...original.arguments];
  }
}
