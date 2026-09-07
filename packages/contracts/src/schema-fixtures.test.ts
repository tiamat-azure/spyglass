import { describe, expect, it } from 'vitest';
import { assertFixtureCorpus, runFixtureCorpus } from './validate.ts';

describe('JSON schema fixture corpus', () => {
  it('accepts every valid fixture and rejects every invalid fixture', () => {
    const report = assertFixtureCorpus();
    expect(report.acceptedValid.length).toBeGreaterThan(0);
    expect(report.rejectedInvalid.length).toBeGreaterThan(0);
    expect(report.rejectedValid).toEqual([]);
    expect(report.acceptedInvalid).toEqual([]);
  });

  it('returns a report object from runFixtureCorpus', () => {
    const report = runFixtureCorpus();
    expect(report.acceptedValid).toContain('raw-event.dom-click.json');
    expect(report.rejectedInvalid).toContain('raw-event.unknown-kind.json');
  });
});
