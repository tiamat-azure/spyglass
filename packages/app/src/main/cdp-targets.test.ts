import { describe, expect, it, vi } from 'vitest';
import {
  GUEST_FALLBACK_CHROME_WARNING,
  isChromeUiUrl,
  parseCdpTargetList,
  pickGuestTarget
} from './cdp-targets.ts';

describe('pickGuestTarget', () => {
  it('prefers the displayed guest URL over the chrome renderer', () => {
    const targets = parseCdpTargetList([
      {
        id: 'chrome',
        type: 'page',
        url: 'file:///app/out/renderer/index.html',
        title: 'Spyglass'
      },
      {
        id: 'guest',
        type: 'page',
        url: 'https://example.com/',
        title: 'Example Domain',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/guest'
      }
    ]);
    expect(isChromeUiUrl('file:///app/out/renderer/index.html')).toBe(true);
    expect(pickGuestTarget(targets, 'https://example.com/')?.id).toBe('guest');
  });

  it('falls back to the first non-chrome page', () => {
    const targets = parseCdpTargetList([
      { id: 'ui', type: 'page', url: 'http://localhost:5173/', title: 'vite' },
      { id: 'start', type: 'page', url: 'file:///app/out/resources/start.html', title: 'start' }
    ]);
    expect(pickGuestTarget(targets)?.id).toBe('start');
  });

  it('falls back to pages[0] with a loud warning when every page is chrome UI', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const targets = parseCdpTargetList([
        {
          id: 'ui',
          type: 'page',
          url: 'file:///app/out/renderer/index.html',
          title: 'Spyglass'
        }
      ]);
      expect(pickGuestTarget(targets)?.id).toBe('ui');
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toBe(GUEST_FALLBACK_CHROME_WARNING);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/privileged chrome UI/i);
    } finally {
      warn.mockRestore();
    }
  });
});
