import { describe, expect, it } from 'vitest';
import { parseEmptyPayload, parseGotoPayload, parseObservePayload } from './ipc-validate.ts';
import { clampSplitRatio, fallbackBrowserBounds, roundBrowserBounds } from './layout.ts';
import { parseObserveStdout } from './stagehand-bridge.ts';

describe('ipc payload validation', () => {
  it('accepts a goto url string and rejects junk', () => {
    expect(parseGotoPayload({ url: 'https://example.com' })).toEqual({
      url: 'https://example.com'
    });
    expect(parseGotoPayload({ url: 12 })).toBeUndefined();
    expect(parseGotoPayload(null)).toBeUndefined();
  });

  it('accepts empty nav payloads', () => {
    expect(parseEmptyPayload({})).toBe(true);
    expect(parseEmptyPayload(undefined)).toBe(true);
    expect(parseEmptyPayload('nope')).toBe(false);
  });

  it('accepts optional observe instructions', () => {
    expect(parseObservePayload({})).toEqual({});
    expect(parseObservePayload({ instruction: 'find links' })).toEqual({
      instruction: 'find links'
    });
    expect(parseObservePayload({ instruction: 1 })).toBeUndefined();
  });
});

describe('layout', () => {
  it('restores a 75% default that still leaves room for the chat min width', () => {
    expect(clampSplitRatio(0.75, 1280)).toBeCloseTo(0.75);
    const bounds = fallbackBrowserBounds(1280, 800);
    expect(bounds.y).toBe(40);
    expect(bounds.width).toBe(Math.round(1280 * 0.75));
  });

  it('rounds and rejects invalid bounds', () => {
    expect(roundBrowserBounds({ x: 1.4, y: 2.6, width: 10.2, height: 20.8 })).toEqual({
      x: 1,
      y: 3,
      width: 10,
      height: 21
    });
    expect(roundBrowserBounds({ x: 0, y: 0, width: 0, height: 10 })).toBeUndefined();
  });
});

describe('parseObserveStdout', () => {
  it('reads the last JSON object from mixed logs', () => {
    const parsed = parseObserveStdout('noise\n{"ok":true,"instruction":"x","observations":[]}\n');
    expect(parsed?.ok).toBe(true);
  });
});
