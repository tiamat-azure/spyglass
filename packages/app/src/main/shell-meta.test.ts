import { describe, expect, it } from 'vitest';
import { formatShellTitle, isProductUiEnabled, SHELL_LOT } from './shell-meta.ts';

describe('Lot 0 shell meta', () => {
  it('identifies the capture lot', () => {
    expect(SHELL_LOT).toBe('4');
    expect(formatShellTitle()).toBe('Spyglass');
  });

  it('enables product UI for Lot 4', () => {
    expect(isProductUiEnabled(SHELL_LOT)).toBe(true);
    expect(isProductUiEnabled('-1')).toBe(false);
  });
});
