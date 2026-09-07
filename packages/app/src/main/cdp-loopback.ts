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
    // WHATWG URL leaves port empty for implicit (and explicit default) 80/443.
    // Matching those would cancel every guest http(s) load if CDP were on 80/443.
    const port = url.port;
    return port.length > 0 && port === String(cdpPort);
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

/** CDP must not share implicit HTTP(S) ports or every `http://` / `https://` load would match. */
export function isUsableCdpPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536 && port !== 80 && port !== 443;
}
