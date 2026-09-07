/**
 * True when a guest document is requesting the local Chromium debug port
 * (`/json/list`, `/json/version`, DevTools websockets, …).
 */
export function isGuestRequestToCdpPort(requestUrl: string, cdpPort: number): boolean {
  if (cdpPort <= 0) {
    return false;
  }
  try {
    const url = new URL(requestUrl);
    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:' &&
      url.protocol !== 'ws:' &&
      url.protocol !== 'wss:'
    ) {
      return false;
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      return false;
    }
    const port = url.port.length > 0 ? url.port : defaultPortForProtocol(url.protocol);
    return port === String(cdpPort);
  } catch {
    return false;
  }
}

function defaultPortForProtocol(protocol: string): string {
  if (protocol === 'https:' || protocol === 'wss:') {
    return '443';
  }
  return '80';
}
