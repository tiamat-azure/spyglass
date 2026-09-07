/**
 * Shared CDP guest targeting for main and the packaged Observe worker.
 * Exact URL first, then same origin + pathname (never a raw string prefix).
 */

const CHROME_UI_HINTS = [
  '/src/renderer/index.html',
  '/renderer/index.html',
  '/out/renderer/index.html'
];

const VITE_UI_PORTS = new Set(['4173', '5173', '5174', '5175']);

/** Logged when Observe / CDP targeting falls back to a chrome-UI page. */
export const GUEST_FALLBACK_CHROME_WARNING =
  '[spyglass] WARNING: No non-chrome guest CDP target matched. Observe may attach to privileged chrome UI (renderer / DevTools). Falling back to the first page target.';

export function isLoopbackHostname(hostname) {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === 'localhost' || host === '::1') {
    return true;
  }
  if (isDottedIpv4Loopback(host)) {
    return true;
  }
  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    if (isDottedIpv4Loopback(mapped)) {
      return true;
    }
    // IPv4-mapped hex: 127.x.x.x is 7fxx:xxxx (Chromium 127.0.0.0/8).
    return mapped.startsWith('7f');
  }
  return false;
}

/** Chromium treats the entire 127.0.0.0/8 range as loopback, not only 127.0.0.1. */
function isDottedIpv4Loopback(host) {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const octets = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return false;
    }
    const n = Number.parseInt(part, 10);
    if (n > 255) {
      return false;
    }
    octets.push(n);
  }
  return octets[0] === 127;
}

export function isChromeUiUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url === 'about:blank') {
    return false;
  }
  if (url.startsWith('devtools:') || url.startsWith('chrome-devtools:')) {
    return true;
  }
  if (url.startsWith('chrome-extension:')) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const loopback = isLoopbackHostname(parsed.hostname);
    const localChrome = parsed.protocol === 'file:' || loopback;
    // Path hints and Vite-client substrings only on file: / loopback — a real guest
    // may contain `/out/renderer/` or `@vite/client` on an arbitrary https origin.
    if (localChrome && (url.includes('__vite') || url.includes('@vite/client'))) {
      return true;
    }
    if (localChrome && CHROME_UI_HINTS.some((hint) => url.includes(hint))) {
      return true;
    }
    if (loopback && VITE_UI_PORTS.has(parsed.port)) {
      return true;
    }
    if (loopback && parsed.pathname.includes('/renderer/')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Same origin + pathname (query/hash may differ). Never a raw string prefix. */
export function urlsMatchOriginAndPathname(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/** Playwright/Stagehand page URL vs the already-picked guest target. */
export function pageMatchesPickedGuest(pageUrl, guestUrl) {
  if (typeof pageUrl !== 'string' || pageUrl.length === 0) {
    return false;
  }
  if (typeof guestUrl !== 'string' || guestUrl.length === 0) {
    return false;
  }
  if (pageUrl === guestUrl) {
    return true;
  }
  return urlsMatchOriginAndPathname(pageUrl, guestUrl);
}

/** Playwright/Stagehand CDP target id for a page (public id, then Playwright internals). */
export function pageCdpTargetId(page) {
  if (page === undefined || page === null || typeof page !== 'object') {
    return undefined;
  }
  if (typeof page._targetId === 'string' && page._targetId.length > 0) {
    return page._targetId;
  }
  if (typeof page.target === 'function') {
    try {
      const target = page.target();
      if (target && typeof target._targetId === 'string' && target._targetId.length > 0) {
        return target._targetId;
      }
    } catch {
      return undefined;
    }
  }
  if (typeof page.id === 'string' && page.id.length > 0) {
    return page.id;
  }
  return undefined;
}

function pageUrlString(page) {
  if (page === undefined || page === null || typeof page !== 'object') {
    return '';
  }
  if (typeof page.url === 'function') {
    try {
      const url = page.url();
      return typeof url === 'string' ? url : '';
    } catch {
      return '';
    }
  }
  return typeof page.url === 'string' ? page.url : '';
}

/**
 * After pickGuestTarget, attach only to the Stagehand page whose CDP id is guest.id.
 * A unique URL match is allowed when no target id is available. Multi-match without
 * an id (or several ids matching guest.id) fails closed — never matching[last].
 */
export function pickStagehandPage(pages, guest, options) {
  if (guest === undefined || guest === null || typeof guest !== 'object') {
    return undefined;
  }
  if (!Array.isArray(pages)) {
    return undefined;
  }
  const excluded = excludeTargetIdSet(options);
  const matching = pages.filter((page) => {
    if (!pageMatchesPickedGuest(pageUrlString(page), guest.url)) {
      return false;
    }
    const id = pageCdpTargetId(page);
    if (typeof id === 'string' && excluded.has(id)) {
      return false;
    }
    return true;
  });
  const guestId = typeof guest.id === 'string' && guest.id.length > 0 ? guest.id : undefined;
  if (guestId !== undefined) {
    const byId = matching.filter((page) => pageCdpTargetId(page) === guestId);
    if (byId.length === 1) {
      return byId[0];
    }
    if (byId.length > 1) {
      return undefined;
    }
  }
  if (matching.length === 1) {
    return matching[0];
  }
  return undefined;
}

export function pickGuestTarget(targets, guestUrl, options) {
  const excluded = excludeTargetIdSet(options);
  const pages = targets.filter((target) => target.type === 'page' || target.type === 'other');
  const eligible = pages.filter((target) => !excluded.has(target.id));

  if (guestUrl !== undefined && guestUrl.length > 0) {
    const exact = eligible.filter((target) => target.url === guestUrl);
    const exactGuest = exact.find((target) => !isChromeUiUrl(target.url));
    if (exactGuest !== undefined) {
      return exactGuest;
    }
    // Same URL as Vite chrome: both page targets look like chrome UI. Last-exact is
    // chrome when the list is [guest, chrome] and excludeTargetIds is empty (pin
    // skipped because chromeUrl === guestUrl). Fail closed unless chrome was excluded.
    if (exact.length > 0) {
      if (excluded.size === 0) {
        return undefined;
      }
      return exact[exact.length - 1];
    }
    const byOriginPath = eligible
      .filter((target) => !isChromeUiUrl(target.url))
      .find((target) => urlsMatchOriginAndPathname(target.url, guestUrl));
    if (byOriginPath !== undefined) {
      return byOriginPath;
    }
  }
  const guests = eligible.filter((target) => !isChromeUiUrl(target.url));
  if (guests[0] !== undefined) {
    return guests[0];
  }
  const fallback = eligible[0];
  if (fallback !== undefined) {
    console.warn(GUEST_FALLBACK_CHROME_WARNING, {
      fallbackId: fallback.id,
      fallbackUrl: fallback.url,
      fallbackTitle: fallback.title
    });
    return fallback;
  }
  return undefined;
}

function excludeTargetIdSet(options) {
  const ids = options?.excludeTargetIds;
  const set = new Set();
  if (!Array.isArray(ids)) {
    return set;
  }
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) {
      set.add(id);
    }
  }
  return set;
}

/**
 * Pin the chrome BrowserWindow CDP target while its URL still differs from the guest.
 * When URLs collide, URL matching can pin the guest; callers use
 * webContents.getOrCreateDevToolsTargetId() instead.
 */
export function resolvePinnedChromeTargetId(targets, chromeUrl, guestUrl) {
  if (typeof chromeUrl !== 'string' || chromeUrl.length === 0) {
    return undefined;
  }
  if (typeof guestUrl === 'string' && guestUrl.length > 0 && chromeUrl === guestUrl) {
    return undefined;
  }
  const pages = targets.filter((target) => target.type === 'page' || target.type === 'other');
  const exact = pages.find((target) => target.url === chromeUrl);
  if (exact !== undefined) {
    return exact.id;
  }
  const byOriginPath = pages.find((target) => urlsMatchOriginAndPathname(target.url, chromeUrl));
  if (byOriginPath !== undefined) {
    return byOriginPath.id;
  }
  return undefined;
}
