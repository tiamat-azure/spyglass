/**
 * True when a guest document is requesting the Chromium debug port
 * (`/json/list`, `/json/version`, DevTools websockets, …), on any host.
 * DNS-rebinding to a non-loopback name on the same port is included.
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
    const port = url.port.length > 0 ? url.port : defaultPortForProtocol(url.protocol);
    return port === String(cdpPort);
  } catch {
    return false;
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return true;
  }
  if (host === '::ffff:127.0.0.1' || host.startsWith('::ffff:127.')) {
    return true;
  }
  // WHATWG URL may serialize IPv4-mapped 127.0.0.1 as ::ffff:7f00:1
  return host === '::ffff:7f00:1' || host.startsWith('::ffff:7f');
}

function defaultPortForProtocol(protocol: string): string {
  if (protocol === 'https:' || protocol === 'wss:') {
    return '443';
  }
  return '80';
}
