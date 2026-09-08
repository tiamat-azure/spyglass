export const SHELL_LOT = '3' as const;

export function formatShellTitle(): string {
  return 'Spyglass';
}

export function isProductUiEnabled(lot: string): boolean {
  return lot !== '-1';
}
