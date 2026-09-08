import type { RefinedStep } from '@spyglass/contracts';
import { bestCorrelatedObservation, observeMatchScore } from '@spyglass/llm';
import { describe, expect, it } from 'vitest';

function step(selector: string, description?: string): RefinedStep {
  return {
    index: 0,
    intent: 'Je clique',
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector,
        selectorStrategy: 'css',
        ...(description !== undefined ? { description } : {})
      }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'weak',
      weakReason: 'ambiguous-target',
      confirmedByUser: true
    },
    sourceEvents: ['evt_000001']
  };
}

describe('Lot 5 recovery observe() keeps R3c (never array-index)', () => {
  it('correlates the failing step by selector, ignoring a leading poison observation', () => {
    const failing = step('#later-weak');
    const observations = [{ selector: '#poison-other' }, { selector: '#later-weak' }];
    expect(observeMatchScore(observations[0] ?? {}, failing)).toBe(0);
    const match = bestCorrelatedObservation(failing, observations);
    expect(match?.observation.selector).toBe('#later-weak');
    expect(match?.index).toBe(1);
  });

  it('does not bind observations[0] just because the step is first', () => {
    const failing = step('#first-click');
    const match = bestCorrelatedObservation(failing, [
      { selector: '#unrelated' },
      { selector: '#first-click' }
    ]);
    expect(match?.index).not.toBe(0);
    expect(match?.observation.selector).toBe('#first-click');
  });
});
