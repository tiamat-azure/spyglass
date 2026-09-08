/**
 * C1: deny-by-default window.open and session permissions.
 * Chrome renderer may capture the microphone (Lot 3). Guest stays denied.
 */

export function denyWindowOpenHandler(): { action: 'deny' } {
  return { action: 'deny' };
}

export function isMediaPermission(permission: string): boolean {
  return permission === 'media' || permission === 'audioCapture' || permission === 'microphone';
}

export function allowPermission(options: { isChrome: boolean; permission: string }): boolean {
  return options.isChrome && isMediaPermission(options.permission);
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
