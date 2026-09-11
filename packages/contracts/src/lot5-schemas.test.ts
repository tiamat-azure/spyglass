import { describe, expect, it } from 'vitest';
import {
  schemaFromFixtureName,
  validateExecutionReport,
  validateScenario,
  validateSuggestedPatch
} from './validate.ts';

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

describe('validateExecutionReport', () => {
  it('accepts cancelled step status (L36c-cancelled)', () => {
    expect(
      validateExecutionReport({
        schemaVersion: 1,
        runId: 'run_x',
        sessionId: 'ses_x',
        startedAt: '2026-09-09T00:00:00.000Z',
        finishedAt: '2026-09-09T00:00:01.000Z',
        exitCode: 0,
        headless: true,
        aiRecovery: false,
        maxAiRetries: 3,
        smartModel: 'claude-sonnet-4-5-20250929',
        multimodal: true,
        warnings: [],
        steps: [
          {
            index: 0,
            intent: 'Je clique',
            status: 'cancelled',
            durationMs: 10,
            mode: 'script',
            attempts: 1,
            verificationOk: false,
            error: 'replay stopped by user'
          }
        ]
      }).valid
    ).toBe(true);
  });
});
