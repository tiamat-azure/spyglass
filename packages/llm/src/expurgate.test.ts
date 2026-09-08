import type { RawEvent } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertNoLeak,
  expurgateBatch,
  expurgateEvent,
  expurgatePage,
  expurgateTarget,
  redactUrl,
  scrubText
} from './expurgate.ts';

function event(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    schemaVersion: 1,
    id: 'evt_000123',
    sessionId: 'ses_test',
    ts: 1,
    kind: 'dom.input',
    page: {
      url: 'https://user:pass@exemple.fr/login?token=s3cret&q=ok#frag',
      title: 'Login sk-ant-api03-ABCDEFGHIJKLMNOP'
    },
    target: {
      tag: 'input',
      framePath: ['main'],
      shadowPath: [],
      accessibleName: 'Mot de passe',
      text: 'hunter2-plain and Bearer abcdefghijklmnop',
      cssSelector: '#pwd',
      xpath: '//input[@type="password"]'
    },
    value: { masked: true, secretRef: 'SECRET_PASSWORD' },
    action: {
      type: 'fill',
      selector: '#pwd',
      arguments: ['SECRET_PASSWORD'],
      framePath: ['main'],
      shadowPath: []
    },
    snapshotRef: '<html>full snapshot</html>',
    ...overrides
  };
}

describe('expurgation filter (6.9)', () => {
  it('strips secrets, cookies-like query params, values, and snapshots', () => {
    const clean = expurgateEvent(event());
    const blob = JSON.stringify(clean);
    expect(blob).not.toContain('hunter2-plain');
    expect(blob).not.toContain('SECRET_PASSWORD');
    expect(blob).not.toContain('s3cret');
    expect(blob).not.toContain('user:pass');
    expect(blob).not.toContain('sk-ant-api03');
    expect(blob).not.toContain('Bearer ');
    expect(blob).not.toContain('full snapshot');
    expect(blob).not.toContain('cssSelector');
    expect(blob).not.toContain('xpath');
    expect(clean.target?.accessibleName).toBe('Mot de passe');
    expect(clean.page?.url).toBe('https://exemple.fr/login?q=ok');
  });

  it('never forwards unmasked field values either', () => {
    const clean = expurgateEvent(
      event({
        value: { masked: false, text: 'Ada Lovelace' }
      })
    );
    expect(JSON.stringify(clean)).not.toContain('Ada Lovelace');
  });

  it('is the choke point for a batch: leaks throw', () => {
    const batch = expurgateBatch([event()]);
    expect(() => assertNoLeak(batch, ['SECRET_PASSWORD'])).not.toThrow();
    expect(() => assertNoLeak({ oops: 'SECRET_PASSWORD' }, ['SECRET_PASSWORD'])).toThrow(
      /expurgation leak/
    );
  });

  it('redacts jwt-like and api-key fragments in labels', () => {
    expect(scrubText('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb here')).toContain(
      '[redacted]'
    );
    expect(redactUrl('https://exemple.fr/cb?access_token=xyz&keep=1')).toBe(
      'https://exemple.fr/cb?keep=1'
    );
  });

  it('truncates long visible text', () => {
    const long = 'x'.repeat(200);
    const raw = event({
      kind: 'dom.click',
      target: {
        tag: 'button',
        framePath: ['main'],
        shadowPath: [],
        accessibleName: long,
        text: long
      }
    });
    delete raw.value;
    const clean = expurgateEvent(raw);
    expect(clean.target?.text?.endsWith('…')).toBe(true);
    expect((clean.target?.text ?? '').length).toBeLessThanOrEqual(81);
    expect(clean.target?.accessibleName?.endsWith('…')).toBe(true);
  });

  it('handles malformed URLs without throwing', () => {
    expect(redactUrl('not a url?token=abcd1234')).not.toContain('abcd1234');
    expect(redactUrl('')).toBe('');
  });

  it('covers empty targets, pages, and whitespace labels', () => {
    expect(expurgateTarget(undefined)).toBeUndefined();
    expect(expurgatePage(undefined)).toBeUndefined();
    expect(expurgateTarget({ tag: 'button', framePath: ['main'], shadowPath: [] })).toEqual({
      tag: 'button'
    });
    expect(scrubText('   ')).toBeUndefined();
    expect(redactUrl('https://exemple.fr/x?error_code=1&safe=ok')).toBe(
      'https://exemple.fr/x?safe=ok'
    );
  });
});
