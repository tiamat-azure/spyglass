import type { BrowserBounds, NavGotoRequest, StagehandObserveRequest } from '../shared/ipc.ts';

export function parseGotoPayload(input: unknown): NavGotoRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('url' in input)) {
    return undefined;
  }
  const url = (input as { url: unknown }).url;
  if (typeof url !== 'string') {
    return undefined;
  }
  return { url };
}

export function parseEmptyPayload(input: unknown): boolean {
  if (input === undefined) {
    return true;
  }
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  return true;
}

export function parseBrowserBoundsPayload(input: unknown): BrowserBounds | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (
    typeof record.x !== 'number' ||
    typeof record.y !== 'number' ||
    typeof record.width !== 'number' ||
    typeof record.height !== 'number'
  ) {
    return undefined;
  }
  return {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height
  };
}

export function parseObservePayload(input: unknown): StagehandObserveRequest | undefined {
  if (input === undefined) {
    return {};
  }
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (record.instruction === undefined) {
    return {};
  }
  if (typeof record.instruction !== 'string') {
    return undefined;
  }
  return { instruction: record.instruction };
}
