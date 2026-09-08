import { NARRATION_SYSTEM_PROMPT } from './constants.ts';
import type { ExpurgatedEvent } from './expurgate.ts';

export type NarrationItem = { id: string; text: string };

export type NarrationResponse = { narrations: NarrationItem[] };

export function buildNarrationUserPayload(
  locale: string,
  events: readonly ExpurgatedEvent[]
): string {
  return JSON.stringify({ locale, events });
}

export function buildNarrationMessages(
  events: readonly ExpurgatedEvent[],
  locale = 'fr'
): { system: string; user: string } {
  return {
    system: NARRATION_SYSTEM_PROMPT,
    user: buildNarrationUserPayload(locale, events)
  };
}

/**
 * Reject any response whose id set differs from the batch (prompt contract §1).
 */
export function parseNarrationResponse(
  raw: string,
  expectedIds: readonly string[]
): NarrationResponse | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { error: 'invalid json' };
  }
  if (typeof parsed !== 'object' || parsed === null || !('narrations' in parsed)) {
    return { error: 'missing narrations' };
  }
  const narrations = (parsed as { narrations: unknown }).narrations;
  if (!Array.isArray(narrations)) {
    return { error: 'narrations is not an array' };
  }
  const items: NarrationItem[] = [];
  for (const row of narrations) {
    if (typeof row !== 'object' || row === null) {
      return { error: 'invalid narration row' };
    }
    const record = row as { id?: unknown; text?: unknown };
    if (typeof record.id !== 'string' || typeof record.text !== 'string') {
      return { error: 'invalid narration row' };
    }
    const text = record.text.trim();
    if (text.length === 0) {
      return { error: 'empty narration text' };
    }
    items.push({ id: record.id, text });
  }
  const got = items.map((item) => item.id);
  if (got.length !== expectedIds.length) {
    return { error: 'id set length mismatch' };
  }
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const id of got) {
    if (!expected.has(id) || seen.has(id)) {
      return { error: 'id set mismatch' };
    }
    seen.add(id);
  }
  return { narrations: items };
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1] !== undefined) {
    return fenced[1];
  }
  return trimmed;
}
