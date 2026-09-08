import { describe, expect, it } from 'vitest';
import { schemaFromFixtureName, validateScenario, validateSuggestedPatch } from './validate.ts';

describe('schemaFromFixtureName', () => {
  it('maps lot 5 prefixes', () => {
    expect(schemaFromFixtureName('scenario.click.json')).toBe('scenario');
    expect(schemaFromFixtureName('execution-report.pass.json')).toBe('execution-report');
    expect(schemaFromFixtureName('suggested-patch.action.json')).toBe('suggested-patch');
  });
});

describe('validateScenario', () => {
  it('accepts a one-step scenario', () => {
    expect(
      validateScenario({
        schemaVersion: 1,
        sessionId: 'ses_x',
        startUrl: 'https://exemple.test',
        steps: [
          {
            index: 0,
            intent: 'Je clique',
            action: { type: 'click', descriptor: { type: 'click', selector: '#a' } },
            verification: {
              type: 'elementVisible',
              expected: '#a',
              strength: 'strong',
              confirmedByUser: true
            },
            sourceEvents: ['evt_000001']
          }
        ]
      }).valid
    ).toBe(true);
  });
});

describe('validateSuggestedPatch', () => {
  it('rejects applied true (Lot 5 never auto-applies)', () => {
    expect(
      validateSuggestedPatch({
        schemaVersion: 1,
        runId: 'run_x',
        sessionId: 'ses_x',
        applied: true,
        patches: []
      }).valid
    ).toBe(false);
  });
});
