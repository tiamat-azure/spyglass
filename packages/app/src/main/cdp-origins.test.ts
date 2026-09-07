import { describe, expect, it } from 'vitest';
import { CDP_REMOTE_ALLOW_ORIGINS } from './cdp-origins.ts';

describe('CDP_REMOTE_ALLOW_ORIGINS', () => {
  it('is the empty string and not a wildcard', () => {
    expect(CDP_REMOTE_ALLOW_ORIGINS).toBe('');
    expect(CDP_REMOTE_ALLOW_ORIGINS).not.toBe('*');
  });
});
