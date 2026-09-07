import {
  GUEST_FALLBACK_CHROME_WARNING,
  isChromeUiUrl,
  pageMatchesPickedGuest,
  pickGuestTarget as pickGuestTargetImpl,
  pickStagehandPage as pickStagehandPageImpl,
  resolvePinnedChromeTargetId,
  urlsMatchOriginAndPathname
} from '../../scripts/cdp-guest.mjs';
import type { CdpTarget } from '../shared/ipc.ts';

export {
  GUEST_FALLBACK_CHROME_WARNING,
  isChromeUiUrl,
  pageMatchesPickedGuest,
  resolvePinnedChromeTargetId,
  urlsMatchOriginAndPathname
};

export function pickGuestTarget(
  targets: readonly CdpTarget[],
  guestUrl?: string,
  options?: { excludeTargetIds?: readonly string[] }
): CdpTarget | undefined {
  return pickGuestTargetImpl(targets, guestUrl, options);
}

export function pickStagehandPage<T>(
  pages: readonly T[],
  guest: { id?: string; url?: string } | undefined,
  options?: { excludeTargetIds?: readonly string[] }
): T | undefined {
  return pickStagehandPageImpl(pages, guest, options);
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
