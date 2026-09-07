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

export function pickGuestTarget(targets, guestUrl) {
  const pages = targets.filter((target) => target.type === 'page' || target.type === 'other');
  if (guestUrl !== undefined && guestUrl.length > 0) {
    const exact = pages.find((target) => target.url === guestUrl);
    if (exact !== undefined) {
      return exact;
    }
  }
  const guests = pages.filter((target) => !isChromeUiUrl(target.url));
  if (guestUrl !== undefined && guestUrl.length > 0) {
    const byOriginPath = guests.find((target) => urlsMatchOriginAndPathname(target.url, guestUrl));
    if (byOriginPath !== undefined) {
      return byOriginPath;
    }
  }
  if (guests[0] !== undefined) {
    return guests[0];
  }
  const fallback = pages[0];
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
