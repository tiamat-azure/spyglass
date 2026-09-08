export const SHELL_LOT = '2' as const;

export function formatShellTitle(): string {
  return 'Spyglass';
}

export function isProductUiEnabled(lot: string): boolean {
  return lot !== '-1';
}
