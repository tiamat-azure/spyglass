import type { CdpTarget } from '../shared/ipc.ts';

const CHROME_UI_HINTS = [
  '/src/renderer/index.html',
  '/renderer/index.html',
  '/out/renderer/index.html'
];

export function isChromeUiUrl(url: string): boolean {
  if (url.length === 0 || url === 'about:blank') {
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
    if (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      (parsed.port === '5173' || parsed.port === '5174' || parsed.port === '5175')
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function pickGuestTarget(
  targets: readonly CdpTarget[],
  guestUrl?: string
): CdpTarget | undefined {
  const pages = targets.filter((target) => target.type === 'page' || target.type === 'other');
  if (guestUrl !== undefined && guestUrl.length > 0) {
    const exact = pages.find((target) => target.url === guestUrl);
    if (exact !== undefined) {
      return exact;
    }
  }
  const guests = pages.filter((target) => !isChromeUiUrl(target.url));
  if (guestUrl !== undefined && guestUrl.length > 0) {
    const byPrefix = guests.find(
      (target) => target.url.startsWith(guestUrl) || guestUrl.startsWith(target.url)
    );
    if (byPrefix !== undefined) {
      return byPrefix;
    }
  }
  return guests[0] ?? pages.find((target) => !isChromeUiUrl(target.url));
}

export function parseCdpTargetList(input: unknown): CdpTarget[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const targets: CdpTarget[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.type !== 'string') {
      continue;
    }
    if (typeof record.url !== 'string' || typeof record.title !== 'string') {
      continue;
    }
    const target: CdpTarget = {
      id: record.id,
      type: record.type,
      url: record.url,
      title: record.title
    };
    if (typeof record.webSocketDebuggerUrl === 'string') {
      target.webSocketDebuggerUrl = record.webSocketDebuggerUrl;
    }
    targets.push(target);
  }
  return targets;
}
