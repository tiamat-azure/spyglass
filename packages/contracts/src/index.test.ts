import { describe, expect, it } from 'vitest';
import { schemaFiles, validateRawEvent } from './index.ts';

describe('@spyglass/contracts public API', () => {
  it('re-exports schema filenames and validators', () => {
    expect(schemaFiles['raw-event']).toBe('raw-event.schema.json');
    expect(
      validateRawEvent({
        schemaVersion: 1,
        id: 'evt_000999',
        sessionId: 'ses_x',
        ts: 1,
        kind: 'record.stop'
      }).valid
    ).toBe(true);
  });
});
