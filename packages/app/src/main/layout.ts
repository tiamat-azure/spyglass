import type { BrowserBounds } from '../shared/ipc.ts';
import { DEFAULT_SPLIT_RATIO, TOOLBAR_HEIGHT_PX } from '../shared/ipc.ts';

export const CHAT_MIN_PX = 300;
export const GUTTER_PX = 8;
export const BROWSER_MIN_PX = 240;

export function clampSplitRatio(ratio: number, bodyWidth: number): number {
  if (!Number.isFinite(ratio) || bodyWidth <= 0) {
    return DEFAULT_SPLIT_RATIO;
  }
  const minBrowser = Math.min(BROWSER_MIN_PX, Math.max(0, bodyWidth - CHAT_MIN_PX - GUTTER_PX));
  const minRatio = minBrowser / bodyWidth;
  const maxRatio = Math.max(minRatio, (bodyWidth - CHAT_MIN_PX - GUTTER_PX) / bodyWidth);
  const next = Math.min(maxRatio, Math.max(minRatio, ratio));
  if (!Number.isFinite(next)) {
    return DEFAULT_SPLIT_RATIO;
  }
  return next;
}

export function fallbackBrowserBounds(
  contentWidth: number,
  contentHeight: number,
  ratio = DEFAULT_SPLIT_RATIO
): BrowserBounds {
  const width = Math.max(1, contentWidth);
  const height = Math.max(1, contentHeight);
  const clamped = clampSplitRatio(ratio, width);
  const browserWidth = Math.max(1, Math.round(width * clamped));
  const y = Math.min(TOOLBAR_HEIGHT_PX, height);
  return {
    x: 0,
    y,
    width: browserWidth,
    height: Math.max(1, height - y)
  };
}

export function roundBrowserBounds(input: BrowserBounds): BrowserBounds | undefined {
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height)
  ) {
    return undefined;
  }
  const bounds: BrowserBounds = {
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.round(input.width),
    height: Math.round(input.height)
  };
  if (bounds.width < 1 || bounds.height < 1) {
    return undefined;
  }
  if (Math.abs(bounds.x) > 10_000 || Math.abs(bounds.y) > 10_000) {
    return undefined;
  }
  if (bounds.width > 10_000 || bounds.height > 10_000) {
    return undefined;
  }
  return bounds;
}
