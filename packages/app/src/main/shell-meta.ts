export const EMPTY_SHELL_LOT = '-1' as const;

export function formatShellTitle(): string {
  return 'Spyglass';
}

export function isProductUiEnabled(lot: string): boolean {
  return lot !== EMPTY_SHELL_LOT;
}
