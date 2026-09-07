import { describe, expect, it } from 'vitest';
import {
  formatErrors,
  schemaFromFixtureName,
  validateHealth,
  validateRawEvent,
  validateRefinedStep,
  validateUnknown
} from './validate.ts';

describe('schemaFromFixtureName', () => {
  it('maps known prefixes', () => {
    expect(schemaFromFixtureName('raw-event.foo.json')).toBe('raw-event');
    expect(schemaFromFixtureName('refined-step.foo.json')).toBe('refined-step');
    expect(schemaFromFixtureName('health.foo.json')).toBe('health');
  });

  it('rejects unknown prefixes', () => {
    expect(() => schemaFromFixtureName('mystery.json')).toThrow(/Cannot infer schema/);
  });
});

describe('validateRawEvent', () => {
  it('accepts a minimal record.start event', () => {
    const result = validateRawEvent({
      schemaVersion: 1,
      id: 'evt_000001',
      sessionId: 'ses_x',
      ts: 1,
      kind: 'record.start'
    });
    expect(result.valid).toBe(true);
    expect(formatErrors(result.errors)).toBe('');
  });

  it('rejects an implicit any-shaped extra property', () => {
    const result = validateRawEvent({
      schemaVersion: 1,
      id: 'evt_000001',
      sessionId: 'ses_x',
      ts: 1,
      kind: 'record.start',
      surprise: true
    });
    expect(result.valid).toBe(false);
    expect(formatErrors(result.errors).length).toBeGreaterThan(0);
  });
});

describe('validateRefinedStep', () => {
  it('rejects a verification-scope patch (F-62)', () => {
    const result = validateRefinedStep({
      index: 0,
      intent: 'x',
      action: {
        type: 'click',
        descriptor: { type: 'click', selector: '#a' }
      },
      verification: {
        type: 'urlMatches',
        expected: '**',
        strength: 'strong',
        confirmedByUser: true
      },
      sourceEvents: ['evt_1'],
      patchHistory: [
        {
          runId: 'run_1',
          date: '2026-09-07T00:00:00.000Z',
          scope: 'verification',
          reviewedBy: 'qa',
          pullRequest: 'https://example.test/pr/1'
        }
      ]
    });
    expect(result.valid).toBe(false);
  });
});

describe('validateHealth', () => {
  it('accepts a healthy empty candidate list', () => {
    const result = validateHealth({
      schemaVersion: 1,
      sessionId: 'ses_x',
      status: 'healthy',
      appliedPatches: 0,
      patchCandidates: []
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateUnknown', () => {
  it('dispatches by schema name', () => {
    expect(
      validateUnknown('health', {
        schemaVersion: 1,
        sessionId: 'ses_x',
        status: 'stale',
        appliedPatches: 6,
        patchCandidates: []
      }).valid
    ).toBe(true);
  });
});
