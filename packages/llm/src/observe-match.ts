import type { RefinedStep } from '@spyglass/contracts';
import { isReplayDescriptorSufficient } from './refine.ts';

/** Structural Stagehand observe() row. Shared by Lot 4 refine and Lot 5 recovery. */
export type ObserveCandidate = {
  selector?: string;
  description?: string;
  method?: string;
  arguments?: string[];
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

function tokenSetEqual(left: string, right: string): boolean {
  const tokensLeft = new Set(left.split(/\s+/u).filter((token) => token.length > 0));
  const tokensRight = new Set(right.split(/\s+/u).filter((token) => token.length > 0));
  if (tokensLeft.size === 0 || tokensLeft.size !== tokensRight.size) {
    return false;
  }
  for (const token of tokensLeft) {
    if (!tokensRight.has(token)) {
      return false;
    }
  }
  return true;
}

/**
 * Score an observation against a refined step (LOT4-R3c).
 * Exact selector / stable id|testid match, or a strict description match
 * (full equality or whitespace token-set equality). Weak substrings
 * ("lien" ⊆ "lien vers accueil") score 0 and must not write fallbackSelectors.
 */
export function observeMatchScore(observation: ObserveCandidate, step: RefinedStep): number {
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
    tokenSetEqual(obsDesc, stepDesc)
  ) {
    return 40;
  }
  return 0;
}

/** Best correlated observation for a single step. Never uses array index. */
export function bestCorrelatedObservation(
  step: RefinedStep,
  observations: readonly ObserveCandidate[]
): { observation: ObserveCandidate; index: number; score: number } | undefined {
  let best: { observation: ObserveCandidate; index: number; score: number } | undefined;
  for (const [index, observation] of observations.entries()) {
    const score = observeMatchScore(observation, step);
    if (score <= 0) {
      continue;
    }
    if (best === undefined || score > best.score) {
      best = { observation, index, score };
    }
  }
  if (best === undefined) {
    return undefined;
  }
  const tied = observations.filter(
    (observation, index) =>
      index !== best.index && observeMatchScore(observation, step) === best.score
  );
  if (tied.length > 0) {
    return undefined;
  }
  return best;
}

/** LOT4-R3c: attach Stagehand observations only when they correlate to a step. */
export function applyCorrelatedObserveEnrichment(
  steps: readonly RefinedStep[],
  observations: readonly ObserveCandidate[]
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

export function applyMatchedObservation(step: RefinedStep, observation: ObserveCandidate): void {
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
  const nextFallbacks = step.action.descriptor.fallbackSelectors;
  if (nextFallbacks !== undefined) {
    step.action.fallbackSelectors = nextFallbacks;
  }
}
