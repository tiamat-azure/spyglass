import { describe, expect, it } from 'vitest';
import { looksLikeCssSelector, normalizeHttpOrHttpsUrl, resolveReplayGotoUrl } from './http-url.ts';

describe('normalizeHttpOrHttpsUrl (L5-ADV-06)', () => {
  it('accepts already-absolute http and https', () => {
    expect(normalizeHttpOrHttpsUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeHttpOrHttpsUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeHttpOrHttpsUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('does not prepend https to schemeless hostnames or selectors', () => {
    expect(normalizeHttpOrHttpsUrl('example.com/path')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('button#confirm')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('div.foo')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('role=button')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('#id')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('.class')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('button')).toBeUndefined();
  });

  it('rejects non-web schemes and credentials', () => {
    expect(normalizeHttpOrHttpsUrl('file:///tmp/secret')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('https://user:pass@example.com')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('https://user@example.com/path')).toBeUndefined();
  });
});

describe('looksLikeCssSelector', () => {
  it('detects CSS, role, and tag selectors', () => {
    expect(looksLikeCssSelector('button#confirm')).toBe(true);
    expect(looksLikeCssSelector('div.foo')).toBe(true);
    expect(looksLikeCssSelector('role=button')).toBe(true);
    expect(looksLikeCssSelector('#id')).toBe(true);
    expect(looksLikeCssSelector('.class')).toBe(true);
    expect(looksLikeCssSelector('button[data-testid="ok"]')).toBe(true);
    expect(looksLikeCssSelector('example.com/path')).toBe(false);
    expect(looksLikeCssSelector('https://exemple.test/app#confirm')).toBe(false);
  });
});

describe('resolveReplayGotoUrl', () => {
  it('allows http(s) and file fixtures; rejects selectors', () => {
    expect(resolveReplayGotoUrl('https://exemple.test/next')).toBe('https://exemple.test/next');
    expect(resolveReplayGotoUrl('file:///tmp/page.html')).toMatch(/^file:/);
    expect(resolveReplayGotoUrl('button#confirm')).toBeUndefined();
    expect(resolveReplayGotoUrl('javascript:alert(1)')).toBeUndefined();
  });
});
