import { describe, expect, it } from 'vitest';
import { normalizeHttpOrHttpsUrl } from './http-url.ts';

describe('normalizeHttpOrHttpsUrl (chrome nav.goto gate)', () => {
  it('adds https when the scheme is missing', () => {
    expect(normalizeHttpOrHttpsUrl('example.com/path')).toBe('https://example.com/path');
  });

  it('accepts http and https', () => {
    expect(normalizeHttpOrHttpsUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeHttpOrHttpsUrl('https://example.com')).toBe('https://example.com/');
  });

  it('rejects non-web schemes', () => {
    expect(normalizeHttpOrHttpsUrl('file:///tmp/secret')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('')).toBeUndefined();
  });

  it('rejects embedded credentials', () => {
    expect(normalizeHttpOrHttpsUrl('https://user:pass@example.com')).toBeUndefined();
    expect(normalizeHttpOrHttpsUrl('https://user@example.com/path')).toBeUndefined();
  });
});
