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
  if (url.includes('__vite') || url.includes('@vite/client')) {
    return true;
  }
  if (CHROME_UI_HINTS.some((hint) => url.includes(hint))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
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
    // Same URL as Vite chrome: never prefer a pinned chrome id (already excluded).
    // If every exact hit looks like chrome UI, take the last eligible page, not the first.
    if (exact.length > 0) {
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
