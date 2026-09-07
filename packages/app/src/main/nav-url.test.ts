import { describe, expect, it } from 'vitest';
import { isAllowedGuestUrl, normalizeGotoUrl } from './nav-url.ts';

describe('normalizeGotoUrl', () => {
  it('adds https when the scheme is missing', () => {
    expect(normalizeGotoUrl('example.com/path')).toBe('https://example.com/path');
  });

  it('accepts http and https', () => {
    expect(normalizeGotoUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeGotoUrl('https://example.com')).toBe('https://example.com/');
  });

  it('rejects non-web schemes from the URL bar', () => {
    expect(normalizeGotoUrl('file:///tmp/secret')).toBeUndefined();
    expect(normalizeGotoUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeGotoUrl('')).toBeUndefined();
  });
});

describe('isAllowedGuestUrl', () => {
  it('allows http(s) and file for in-view loads', () => {
    expect(isAllowedGuestUrl('https://example.com')).toBe(true);
    expect(isAllowedGuestUrl('file:///tmp/page.html')).toBe(true);
  });

  it('rejects javascript and data URLs', () => {
    expect(isAllowedGuestUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedGuestUrl('data:text/html,hi')).toBe(false);
  });
});
