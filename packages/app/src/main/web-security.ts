/**
 * C1: deny-by-default window.open and session permissions.
 * Guest F-04 replaces the window-open handler after WebContentsView creation.
 */

export function denyWindowOpenHandler(): { action: 'deny' } {
  return { action: 'deny' };
}

export function denyPermissionCheck(): boolean {
  return false;
}

export function denyPermissionRequest(
  _contents: unknown,
  _permission: string,
  callback: (grant: boolean) => void
): void {
  callback(false);
}
