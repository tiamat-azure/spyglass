import { describe, expect, it } from 'vitest';
import { EMPTY_SHELL_LOT, formatShellTitle, isProductUiEnabled } from './shell-meta.ts';

describe('empty shell (Lot -1)', () => {
  it('identifies the tooling lot', () => {
    expect(EMPTY_SHELL_LOT).toBe('-1');
    expect(formatShellTitle()).toBe('Spyglass');
  });

  it('does not enable product UI in this lot', () => {
    expect(isProductUiEnabled(EMPTY_SHELL_LOT)).toBe(false);
  });
});
