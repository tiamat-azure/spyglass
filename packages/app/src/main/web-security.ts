/**
 * C1: deny-by-default window.open and session permissions.
 * Chrome renderer may capture the microphone (Lot 3). Guest stays denied.
 * Camera / mixed audio+video `media` requests are never granted.
 */

export type PermissionGrantOptions = {
  isChrome: boolean;
  permission: string;
  /** Request handler: `details.mediaTypes` (`audio` | `video`). */
  mediaTypes?: readonly string[];
  /** Check handler: `details.mediaType` (`audio` | `video` | `unknown`). */
  mediaType?: string;
};

export function denyWindowOpenHandler(): { action: 'deny' } {
  return { action: 'deny' };
}

export function isMediaPermission(permission: string): boolean {
  return permission === 'media' || permission === 'audioCapture' || permission === 'microphone';
}

function requestedMediaKinds(options: PermissionGrantOptions): string[] | undefined {
  if (options.mediaTypes !== undefined && options.mediaTypes.length > 0) {
    return [...options.mediaTypes];
  }
  if (options.mediaType !== undefined && options.mediaType.length > 0) {
    return [options.mediaType];
  }
  return undefined;
}

function isAudioOnlyMedia(kinds: readonly string[]): boolean {
  return kinds.length > 0 && kinds.every((kind) => kind === 'audio');
}

export function allowPermission(options: PermissionGrantOptions): boolean {
  if (!options.isChrome) {
    return false;
  }
  if (options.permission === 'audioCapture' || options.permission === 'microphone') {
    return true;
  }
  if (options.permission !== 'media') {
    return false;
  }
  const kinds = requestedMediaKinds(options);
  return kinds !== undefined && isAudioOnlyMedia(kinds);
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
