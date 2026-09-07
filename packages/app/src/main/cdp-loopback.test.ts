import { describe, expect, it } from 'vitest';
import { isGuestRequestToCdpPort } from './cdp-loopback.ts';

describe('isGuestRequestToCdpPort', () => {
  it('blocks loopback HTTP and WS to the active CDP port', () => {
    expect(isGuestRequestToCdpPort('http://127.0.0.1:9222/json/list', 9222)).toBe(true);
    expect(isGuestRequestToCdpPort('http://localhost:9222/json/version', 9222)).toBe(true);
    expect(isGuestRequestToCdpPort('ws://127.0.0.1:9222/devtools/browser/abc', 9222)).toBe(true);
  });

  it('does not block other ports, hosts, or when CDP is off', () => {
    expect(isGuestRequestToCdpPort('http://127.0.0.1:9222/json/list', 0)).toBe(false);
    expect(isGuestRequestToCdpPort('http://127.0.0.1:80/json/list', 9222)).toBe(false);
    expect(isGuestRequestToCdpPort('https://example.com/json/list', 9222)).toBe(false);
    expect(isGuestRequestToCdpPort('http://127.0.0.1:4173/', 9222)).toBe(false);
  });
});
