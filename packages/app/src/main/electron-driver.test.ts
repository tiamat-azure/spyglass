import { describe, expect, it } from 'vitest';
import { guestScript } from './electron-guest-script.ts';

describe('ElectronPageDriver guest scripts', () => {
  it('wraps query helpers so top-level return is valid (isVisible)', () => {
    const script = guestScript(`
      const el = spyglassQuery('#step-1');
      if (!el) { return false; }
      return true;
    `);
    expect(() => new Function(script)).not.toThrow();
    expect(script.startsWith('(() => {')).toBe(true);
  });
});
