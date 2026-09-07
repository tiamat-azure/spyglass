import { describe, expect, it, vi } from 'vitest';
import {
  GUEST_FALLBACK_CHROME_WARNING,
  isChromeUiUrl,
  pageMatchesPickedGuest,
  parseCdpTargetList,
  pickGuestTarget,
  urlsMatchOriginAndPathname
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

  it('matches same origin and pathname when query/hash differ', () => {
    const targets = parseCdpTargetList([
      {
        id: 'chrome',
        type: 'page',
        url: 'file:///app/out/renderer/index.html',
        title: 'Spyglass'
      },
      { id: 'guest', type: 'page', url: 'https://example.com/', title: 'Example' },
      { id: 'other', type: 'page', url: 'https://other.test/', title: 'Other' }
    ]);
    expect(pickGuestTarget(targets, 'https://example.com/?q=1')?.id).toBe('guest');
    expect(urlsMatchOriginAndPathname('https://example.com/', 'https://example.com/?q=1')).toBe(
      true
    );
  });

  it('does not treat a hostname prefix as a match', () => {
    const targets = parseCdpTargetList([
      {
        id: 'chrome',
        type: 'page',
        url: 'file:///app/out/renderer/index.html',
        title: 'Spyglass'
      },
      { id: 'evil', type: 'page', url: 'https://example.com.evil.com/', title: 'Evil' },
      { id: 'guest', type: 'page', url: 'https://example.com/', title: 'Example' }
    ]);
    expect(pickGuestTarget(targets, 'https://example.com')?.id).toBe('guest');
    expect(urlsMatchOriginAndPathname('https://example.com.evil.com/', 'https://example.com')).toBe(
      false
    );
  });

  it('does not match a different pathname on the same origin', () => {
    const targets = parseCdpTargetList([
      {
        id: 'chrome',
        type: 'page',
        url: 'file:///app/out/renderer/index.html',
        title: 'Spyglass'
      },
      { id: 'other-path', type: 'page', url: 'https://example.com/other', title: 'Other path' },
      { id: 'home', type: 'page', url: 'https://example.com/', title: 'Home' }
    ]);
    expect(pickGuestTarget(targets, 'https://example.com')?.id).toBe('home');
    expect(urlsMatchOriginAndPathname('https://example.com/other', 'https://example.com')).toBe(
      false
    );
  });
});

describe('isChromeUiUrl', () => {
  it('treats chrome-devtools and Vite client URLs as chrome UI', () => {
    expect(isChromeUiUrl('chrome-devtools://devtools/bundled/inspector.html')).toBe(true);
    expect(isChromeUiUrl('devtools://devtools/bundled/inspector.html')).toBe(true);
    expect(isChromeUiUrl('http://example.com/@vite/client')).toBe(true);
    expect(isChromeUiUrl('http://example.com/__vite_ping')).toBe(true);
  });

  it('does not treat the guest start page as chrome UI', () => {
    expect(isChromeUiUrl('file:///app/out/resources/start.html')).toBe(false);
    expect(isChromeUiUrl('https://example.com/')).toBe(false);
  });
});

describe('pageMatchesPickedGuest', () => {
  it('prefers exact then origin+pathname against the picked guest', () => {
    expect(pageMatchesPickedGuest('https://example.com/', 'https://example.com/')).toBe(true);
    expect(pageMatchesPickedGuest('https://example.com/?q=1', 'https://example.com/')).toBe(true);
  });

  it('does not match the first non-chrome page or a hostname prefix', () => {
    expect(pageMatchesPickedGuest('https://other.test/', 'https://example.com/')).toBe(false);
    expect(pageMatchesPickedGuest('https://example.com.evil.com/', 'https://example.com')).toBe(
      false
    );
    expect(pageMatchesPickedGuest('https://example.com/other', 'https://example.com/')).toBe(false);
  });
});
