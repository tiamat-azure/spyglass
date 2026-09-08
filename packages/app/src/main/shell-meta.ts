export const SHELL_LOT = '5' as const;

export function formatShellTitle(): string {
  return 'Spyglass';
}

export function isProductUiEnabled(lot: string): boolean {
  return lot !== '-1';
}
