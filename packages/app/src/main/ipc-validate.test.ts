import { describe, expect, it } from 'vitest';
import { refineSourceBanner } from '../shared/ipc.ts';
import {
  asPcmFrame,
  parseConfigSetPayload,
  parseConfigTestPayload,
  parseEmptyPayload,
  parseGotoPayload,
  parseGuestVisiblePayload,
  parseObservePayload,
  parseRaiseCeilingPayload,
  parseRefineConfirmPayload,
  parseRefineEditPayload,
  parseRefineEstimatePayload,
  parseRefineRunPayload,
  parseReplayStartPayload,
  parseRetractPayload,
  parseSessionStartPayload,
  parseVoiceEditPayload,
  parseVoiceStartPayload,
  sessionBundleIpcError
} from './ipc-validate.ts';
import {
  clampBrowserBoundsToChrome,
  clampSplitRatio,
  fallbackBrowserBounds,
  roundBrowserBounds
} from './layout.ts';
import { observeScriptPath, parseObserveStdout, withObserveMutex } from './stagehand-bridge.ts';

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

describe('session payload validation', () => {
  it('accepts optional startUrl and retract event ids', () => {
    expect(parseSessionStartPayload({})).toEqual({});
    expect(parseSessionStartPayload({ startUrl: 'https://example.com' })).toEqual({
      startUrl: 'https://example.com'
    });
    expect(parseRetractPayload({ eventId: 'evt_000001' })).toEqual({ eventId: 'evt_000001' });
    expect(parseRetractPayload({})).toBeUndefined();
  });

  it('parses config and guest-visibility payloads', () => {
    expect(parseConfigTestPayload({ profile: 'fast' })).toEqual({ profile: 'fast' });
    expect(parseConfigTestPayload({ profile: 'nope' })).toBeUndefined();
    expect(parseGuestVisiblePayload({ visible: false })).toEqual({ visible: false });
    expect(parseRaiseCeilingPayload({ tokens: 8000 })).toEqual({ tokens: 8000 });
    expect(parseConfigSetPayload({ profile: 'fast', apiKey: 'sk-x' })?.apiKey).toBe('sk-x');
  });

  it('parses voice start/edit and PCM frames', () => {
    expect(parseVoiceStartPayload({ mode: 'hold' })).toEqual({ mode: 'hold' });
    expect(parseVoiceStartPayload({ mode: 'continuous' })).toEqual({ mode: 'continuous' });
    expect(parseVoiceStartPayload({ mode: 'shout' })).toBeUndefined();
    expect(parseVoiceEditPayload({ eventId: 'evt_000010', text: 'ok' })).toEqual({
      eventId: 'evt_000010',
      text: 'ok'
    });
    const frame = asPcmFrame(new Int16Array([1, 2, 3]).buffer);
    expect(frame?.length).toBe(6);
    expect(asPcmFrame('nope')).toBeUndefined();
  });

  it('parses refine estimate/run/confirm/edit payloads', () => {
    expect(parseRefineEstimatePayload({ aggressiveness: 'aggressive' })).toEqual({
      aggressiveness: 'aggressive'
    });
    expect(parseRefineEstimatePayload(null)).toEqual({});
    expect(parseRefineRunPayload({ aggressiveness: 'balanced', confirm: true })).toEqual({
      aggressiveness: 'balanced',
      confirm: true
    });
    expect(parseRefineRunPayload('nope')).toBeUndefined();
    expect(parseRefineConfirmPayload({ routine: true })).toEqual({ routine: true });
    expect(parseRefineConfirmPayload({ index: 2 })).toEqual({ index: 2 });
    expect(parseRefineConfirmPayload({})).toBeUndefined();
    expect(parseRefineEditPayload({ index: 0, intent: 'Je valide' })).toEqual({
      index: 0,
      intent: 'Je valide'
    });
    expect(parseReplayStartPayload({ forceAi: true })).toEqual({ forceAi: true });
    expect(parseReplayStartPayload({ noAi: true })).toEqual({ noAi: true });
    expect(parseReplayStartPayload(null)).toEqual({});
    expect(parseReplayStartPayload({ datasetPath: '/tmp/ds.json', stepByStep: true })).toEqual({
      stepByStep: true
    });
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

  it('clamps browserBounds below the toolbar so the view cannot cover the URL bar', () => {
    expect(clampBrowserBoundsToChrome({ x: 0, y: 0, width: 960, height: 800 }, 1280, 800)).toEqual({
      x: 0,
      y: 40,
      width: 960,
      height: 760
    });
    expect(clampBrowserBoundsToChrome({ x: 0, y: 40, width: 960, height: 760 }, 1280, 800)).toEqual(
      {
        x: 0,
        y: 40,
        width: 960,
        height: 760
      }
    );
  });
});

describe('parseObserveStdout', () => {
  it('reads the last JSON object from mixed logs', () => {
    const parsed = parseObserveStdout('noise\n{"ok":true,"instruction":"x","observations":[]}\n');
    expect(parsed).toEqual({
      ok: true,
      instruction: 'x',
      observations: []
    });
  });

  it('normalizes a missing observations array', () => {
    const parsed = parseObserveStdout('{"ok":false,"instruction":"x","error":"nope"}');
    expect(parsed).toEqual({
      ok: false,
      instruction: 'x',
      observations: [],
      error: 'nope'
    });
  });

  it('rejects non-boolean ok and non-array observations', () => {
    expect(parseObserveStdout('{"ok":true,"observations":"all of them"}')).toBeUndefined();
    expect(parseObserveStdout('{"ok":"yes","observations":[]}')).toBeUndefined();
  });

  it('keeps a later valid payload when an earlier {ok} line is junk', () => {
    const parsed = parseObserveStdout(
      '{"ok":true}\n{"ok":true,"instruction":"find","observations":[{"description":"Go"}]}'
    );
    expect(parsed?.ok).toBe(true);
    expect(parsed?.instruction).toBe('find');
    expect(parsed?.observations).toEqual([{ description: 'Go' }]);
  });

  it('resolves the observe script from the source checkout layout', () => {
    expect(observeScriptPath()).toMatch(/stagehand-observe\.mjs$/);
  });
});

describe('withObserveMutex', () => {
  it('runs overlapping observe work one at a time', async () => {
    const order: number[] = [];
    await Promise.all([
      withObserveMutex(async () => {
        order.push(1);
        await new Promise((resolve) => setTimeout(resolve, 25));
        order.push(2);
      }),
      withObserveMutex(async () => {
        order.push(3);
      })
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('refineSourceBanner (LOT4-R1)', () => {
  it('labels fallback so it cannot be mistaken for smart', () => {
    const fallback = refineSourceBanner('fallback');
    expect(fallback.tone).toBe('fallback');
    expect(fallback.text).toMatch(/repli déterministe/i);
    expect(fallback.text).toMatch(/pas un raffinement smart/i);
    const smart = refineSourceBanner('smart');
    expect(smart.tone).toBe('smart');
    expect(smart.text).toMatch(/smart/i);
    expect(smart.text).not.toMatch(/repli/i);
  });
});

describe('sessionBundleIpcError (L7-088)', () => {
  it('maps known bundle refusals to stable codes without leaking paths', () => {
    expect(
      sessionBundleIpcError(new Error('export refused: destination is not empty'), 'export-failed')
    ).toBe('dest-not-empty');
    expect(
      sessionBundleIpcError(
        new Error('export refused: destination is not a directory'),
        'export-failed'
      )
    ).toBe('dest-not-directory');
    expect(
      sessionBundleIpcError(new Error('import refused: session already exists'), 'import-failed')
    ).toBe('session-exists');
    expect(
      sessionBundleIpcError(new Error('import refused: invalid sessionId'), 'import-failed')
    ).toBe('invalid-session');
    expect(
      sessionBundleIpcError(new Error('ENOENT: no such file /home/alice/secret'), 'export-failed')
    ).toBe('export-failed');
    const missing = new Error('no such file /abs/path/session') as NodeJS.ErrnoException;
    missing.code = 'ENOENT';
    expect(sessionBundleIpcError(missing, 'import-failed')).toBe('not-found');
    expect(
      sessionBundleIpcError(new Error('import refused: symlinks are not allowed'), 'import-failed')
    ).toBe('symlink');
  });

  it('returns the fallback when the rejection is null, undefined, or not an object (L7-092)', () => {
    expect(sessionBundleIpcError(null, 'export-failed')).toBe('export-failed');
    expect(sessionBundleIpcError(undefined, 'import-failed')).toBe('import-failed');
    expect(sessionBundleIpcError('boom', 'export-failed')).toBe('export-failed');
    expect(sessionBundleIpcError(42, 'import-failed')).toBe('import-failed');
  });
});
