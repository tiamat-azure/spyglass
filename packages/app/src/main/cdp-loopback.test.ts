import { describe, expect, it } from 'vitest';
import { isGuestRequestToCdpPort, isLoopbackHostname, isUsableCdpPort } from './cdp-loopback.ts';

describe('isGuestRequestToCdpPort', () => {
  it('blocks loopback HTTP and WS to the active CDP port', () => {
    expect(isGuestRequestToCdpPort('http://127.0.0.1:9222/json/list', 9222)).toBe(true);
    expect(isGuestRequestToCdpPort('http://localhost:9222/json/version', 9222)).toBe(true);
    expect(isGuestRequestToCdpPort('ws://127.0.0.1:9222/devtools/browser/abc', 9222)).toBe(true);
  });

  it('blocks DNS-rebind hosts that use the CDP port', () => {
    expect(isGuestRequestToCdpPort('http://attacker.test:9222/json/list', 9222)).toBe(true);
    expect(isGuestRequestToCdpPort('http://example.com:9222/json/version', 9222)).toBe(true);
  });

  it('blocks IPv6 and IPv4-mapped loopback forms of the CDP port', () => {
    expect(isGuestRequestToCdpPort('http://[::1]:9222/json/list', 9222)).toBe(true);
    expect(isGuestRequestToCdpPort('http://[::ffff:127.0.0.1]:9222/json/list', 9222)).toBe(true);
    expect(isLoopbackHostname(new URL('http://[::1]:9222/').hostname)).toBe(true);
    expect(isLoopbackHostname(new URL('http://[::ffff:127.0.0.1]:9222/').hostname)).toBe(true);
    expect(isLoopbackHostname('127.0.0.2')).toBe(true);
    expect(isLoopbackHostname('127.255.255.255')).toBe(true);
    expect(isLoopbackHostname('::ffff:127.0.0.2')).toBe(true);
    expect(isLoopbackHostname('126.0.0.1')).toBe(false);
    expect(isLoopbackHostname('8.8.8.8')).toBe(false);
  });

  it('does not block other ports or when CDP is off', () => {
    expect(isGuestRequestToCdpPort('http://127.0.0.1:9222/json/list', 0)).toBe(false);
    expect(isGuestRequestToCdpPort('http://127.0.0.1:80/json/list', 9222)).toBe(false);
    expect(isGuestRequestToCdpPort('https://example.com/json/list', 9222)).toBe(false);
    expect(isGuestRequestToCdpPort('http://127.0.0.1:4173/', 9222)).toBe(false);
    expect(isGuestRequestToCdpPort('http://attacker.test:8080/json/list', 9222)).toBe(false);
  });

  it('does not treat implicit default ports 80/443 as the CDP port', () => {
    // WHATWG URL omits the default port, so url.port is '' for http:80 and https:443.
    expect(isGuestRequestToCdpPort('https://example.com/', 443)).toBe(false);
    expect(isGuestRequestToCdpPort('http://example.com/', 80)).toBe(false);
    expect(isGuestRequestToCdpPort('https://example.com/json/list', 443)).toBe(false);
    expect(isGuestRequestToCdpPort('https://example.com:443/', 443)).toBe(false);
    expect(isGuestRequestToCdpPort('http://example.com:80/', 80)).toBe(false);
    expect(isUsableCdpPort(80)).toBe(false);
    expect(isUsableCdpPort(443)).toBe(false);
    expect(isUsableCdpPort(9222)).toBe(true);
  });
});
