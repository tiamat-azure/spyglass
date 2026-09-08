import { describe, expect, it } from 'vitest';
import { isStaleCeilingRaiseCta } from './ceiling-cta.ts';

describe('stale ceiling raise CTA', () => {
  it('keeps the warn-row raise action clickable while halt is not ceiling', () => {
    expect(isStaleCeilingRaiseCta('none', 'warning')).toBe(false);
    expect(isStaleCeilingRaiseCta('error', 'warning')).toBe(false);
    expect(isStaleCeilingRaiseCta('none', undefined)).toBe(false);
  });

  it('disables only danger-row raise CTAs after the ceiling is cleared', () => {
    expect(isStaleCeilingRaiseCta('none', 'danger')).toBe(true);
    expect(isStaleCeilingRaiseCta('error', 'danger')).toBe(true);
    expect(isStaleCeilingRaiseCta('offline', 'danger')).toBe(true);
    expect(isStaleCeilingRaiseCta('ceiling', 'danger')).toBe(false);
  });
});
