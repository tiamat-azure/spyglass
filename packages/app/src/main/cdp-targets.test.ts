import { describe, expect, it, vi } from 'vitest';
import {
  GUEST_FALLBACK_CHROME_WARNING,
  isChromeUiUrl,
  pageMatchesPickedGuest,
  parseCdpTargetList,
  pickGuestTarget,
  pickStagehandPage,
  resolvePinnedChromeTargetId,
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

  it('does not skip a remote guest whose path contains /out/renderer/', () => {
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
        url: 'https://docs.example.com/guide/out/renderer/index.html?q=1',
        title: 'Docs'
      }
    ]);
    expect(isChromeUiUrl('https://docs.example.com/guide/out/renderer/index.html?q=1')).toBe(false);
    expect(pickGuestTarget(targets)?.id).toBe('guest');
    expect(
      pickGuestTarget(targets, 'https://docs.example.com/guide/out/renderer/index.html?q=1')?.id
    ).toBe('guest');
  });

  it('falls back to the first eligible chrome page with a loud warning when every page is chrome UI', () => {
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

  it('does not return Vite chrome when chrome and guest share localhost:5173', () => {
    const targets = parseCdpTargetList([
      {
        id: 'chrome',
        type: 'page',
        url: 'http://localhost:5173/',
        title: 'Spyglass'
      },
      {
        id: 'guest',
        type: 'page',
        url: 'http://localhost:5173/',
        title: 'Guest'
      }
    ]);
    expect(
      pickGuestTarget(targets, 'http://localhost:5173/', { excludeTargetIds: ['chrome'] })?.id
    ).toBe('guest');
    expect(
      pickGuestTarget(
        parseCdpTargetList([
          {
            id: 'guest',
            type: 'page',
            url: 'http://localhost:5173/',
            title: 'Guest'
          },
          {
            id: 'chrome',
            type: 'page',
            url: 'http://localhost:5173/',
            title: 'Spyglass'
          }
        ]),
        'http://localhost:5173/',
        { excludeTargetIds: ['chrome'] }
      )?.id
    ).toBe('guest');
  });

  it('fails closed when [guest, chrome] share localhost:5173 and chrome is not excluded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const colliding = parseCdpTargetList([
        {
          id: 'guest',
          type: 'page',
          url: 'http://localhost:5173/',
          title: 'Guest'
        },
        {
          id: 'chrome',
          type: 'page',
          url: 'http://localhost:5173/',
          title: 'Spyglass'
        }
      ]);
      expect(pickGuestTarget(colliding, 'http://localhost:5173/')).toBeUndefined();
      expect(
        pickGuestTarget(
          parseCdpTargetList([
            {
              id: 'chrome',
              type: 'page',
              url: 'http://localhost:5173/',
              title: 'Spyglass'
            },
            {
              id: 'guest',
              type: 'page',
              url: 'http://localhost:5173/',
              title: 'Guest'
            }
          ]),
          'http://localhost:5173/'
        )
      ).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('pins chrome by URL only while chrome and guest URLs differ', () => {
    const targets = parseCdpTargetList([
      {
        id: 'chrome',
        type: 'page',
        url: 'http://localhost:5173/',
        title: 'Spyglass'
      },
      {
        id: 'guest',
        type: 'page',
        url: 'file:///app/out/resources/start.html',
        title: 'start'
      }
    ]);
    expect(
      resolvePinnedChromeTargetId(
        targets,
        'http://localhost:5173/',
        'file:///app/out/resources/start.html'
      )
    ).toBe('chrome');
    expect(
      resolvePinnedChromeTargetId(targets, 'http://localhost:5173/', 'http://localhost:5173/')
    ).toBeUndefined();
  });

  it('does not re-select excluded chrome when no guest remains', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const targets = parseCdpTargetList([
        {
          id: 'chrome',
          type: 'page',
          url: 'file:///app/out/renderer/index.html',
          title: 'Spyglass'
        }
      ]);
      expect(pickGuestTarget(targets, undefined, { excludeTargetIds: ['chrome'] })).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('isChromeUiUrl', () => {
  it('treats chrome-devtools and local Vite client URLs as chrome UI', () => {
    expect(isChromeUiUrl('chrome-devtools://devtools/bundled/inspector.html')).toBe(true);
    expect(isChromeUiUrl('devtools://devtools/bundled/inspector.html')).toBe(true);
    expect(isChromeUiUrl('http://localhost:3000/@vite/client')).toBe(true);
    expect(isChromeUiUrl('http://127.0.0.1:3000/__vite_ping')).toBe(true);
  });

  it('does not treat the guest start page as chrome UI', () => {
    expect(isChromeUiUrl('file:///app/out/resources/start.html')).toBe(false);
    expect(isChromeUiUrl('https://example.com/')).toBe(false);
  });

  it('does not treat a remote guest path that looks like renderer or Vite as chrome UI', () => {
    expect(isChromeUiUrl('https://docs.example.com/guide/out/renderer/index.html?q=1')).toBe(false);
    expect(isChromeUiUrl('https://docs.example.com/src/renderer/index.html')).toBe(false);
    expect(isChromeUiUrl('https://example.com/@vite/client')).toBe(false);
    expect(isChromeUiUrl('https://example.com/__vite_ping')).toBe(false);
  });

  it('treats Vite preview and localhost renderer paths as chrome UI', () => {
    expect(isChromeUiUrl('http://localhost:4173/')).toBe(true);
    expect(isChromeUiUrl('http://127.0.0.1:4173/index.html')).toBe(true);
    expect(isChromeUiUrl('http://localhost:8080/out/renderer/index.html')).toBe(true);
    expect(isChromeUiUrl('http://127.0.0.1:3000/src/renderer/main.ts')).toBe(true);
    expect(isChromeUiUrl('http://localhost:3000/')).toBe(false);
  });

  it('treats IPv6 and IPv4-mapped loopback as local chrome for path and Vite hints', () => {
    expect(isChromeUiUrl('http://[::1]:4173/')).toBe(true);
    expect(isChromeUiUrl('http://[::ffff:127.0.0.1]:4173/')).toBe(true);
    expect(isChromeUiUrl('http://[::1]:8080/out/renderer/index.html')).toBe(true);
    expect(isChromeUiUrl('http://[::ffff:127.0.0.1]:3000/@vite/client')).toBe(true);
    expect(isChromeUiUrl('http://[::ffff:7f00:1]:4173/')).toBe(true);
    expect(isChromeUiUrl('http://[::ffff:7ace:1]:4173/')).toBe(false);
    expect(isChromeUiUrl('http://[::1]:3000/__vite_ping')).toBe(true);
    expect(isChromeUiUrl('http://[::1]:3000/')).toBe(false);
  });

  it('treats the entire 127.0.0.0/8 range as local chrome for path and Vite hints', () => {
    expect(isChromeUiUrl('http://127.0.0.2:4173/')).toBe(true);
    expect(isChromeUiUrl('http://127.1.2.3:8080/out/renderer/index.html')).toBe(true);
    expect(isChromeUiUrl('http://127.255.255.255:3000/@vite/client')).toBe(true);
    expect(isChromeUiUrl('http://126.0.0.1:4173/')).toBe(false);
    expect(isChromeUiUrl('http://128.0.0.1:4173/')).toBe(false);
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

describe('pickStagehandPage', () => {
  const colliding = 'http://localhost:5173/';

  it('prefers the page whose target id equals the picked guest id', () => {
    const guest = { id: 'guest', url: colliding };
    const pages = [
      { id: 'chrome', url: colliding },
      { id: 'guest', url: colliding }
    ];
    expect(pickStagehandPage(pages, guest)?.id).toBe('guest');
    expect(pickStagehandPage([...pages].reverse(), guest)?.id).toBe('guest');
  });

  it('fails closed when multiple URL matches do not include guest.id', () => {
    const guest = { id: 'guest', url: colliding };
    const pages = [
      { id: 'chrome', url: colliding },
      { id: 'other', url: colliding }
    ];
    expect(pickStagehandPage(pages, guest)).toBeUndefined();
  });

  it('fails closed when URL matches are ambiguous and pages have no target id', () => {
    const guest = { id: 'guest', url: colliding };
    const pages = [{ url: colliding }, { url: colliding }];
    expect(pickStagehandPage(pages, guest)).toBeUndefined();
  });

  it('returns the sole URL match when target ids are unavailable', () => {
    const guest = { id: 'guest', url: 'https://example.com/' };
    const pages = [{ url: 'https://example.com/' }];
    expect(pickStagehandPage(pages, guest)?.url).toBe('https://example.com/');
  });

  it('fails closed when guest.id is missing from pages that expose CDP ids', () => {
    const guest = { id: 'guest', url: colliding };
    expect(pickStagehandPage([{ id: 'chrome', url: colliding }], guest)).toBeUndefined();
    expect(
      pickStagehandPage([{ id: 'chrome', url: colliding }, { url: colliding }], guest)
    ).toBeUndefined();
  });
});
