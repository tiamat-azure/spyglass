import type { ElementDescriptor, RawEvent } from '@spyglass/contracts';
import { EXPURGATE_TEXT_MAX } from './constants.ts';

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'password',
  'passwd',
  'secret',
  'auth',
  'authorization',
  'session',
  'sessionid',
  'jwt',
  'code',
  'cookie',
  'csrf',
  'sso'
]);

const SECRET_LIKE =
  /sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|SECRET_[A-Z0-9_]+/gi;

export type ExpurgatedTarget = {
  tag?: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  testId?: string;
  name?: string;
};

export type ExpurgatedEvent = {
  id: string;
  kind: string;
  target?: ExpurgatedTarget;
  page?: { url: string; title?: string };
};

/**
 * Unique choke point before any remote profile (PRD 6.9).
 * Never returns field values, cookies, tokens, snapshots, or secret refs.
 */
export function expurgateEvent(event: RawEvent): ExpurgatedEvent {
  const clean: ExpurgatedEvent = {
    id: event.id,
    kind: event.kind
  };
  const dropText = event.value !== undefined || isFieldKind(event.kind);
  const target = expurgateTarget(event.target, dropText);
  if (target !== undefined) {
    clean.target = target;
  }
  const page = expurgatePage(event.page);
  if (page !== undefined) {
    clean.page = page;
  }
  return clean;
}

export function expurgateBatch(events: readonly RawEvent[]): ExpurgatedEvent[] {
  return events.map(expurgateEvent);
}

export function expurgateTarget(
  target: ElementDescriptor | undefined,
  dropText = false
): ExpurgatedTarget | undefined {
  if (target === undefined) {
    return undefined;
  }
  const clean: ExpurgatedTarget = {};
  assignScrubbed(clean, 'tag', target.tag);
  assignScrubbed(clean, 'role', target.role);
  assignScrubbed(clean, 'accessibleName', target.accessibleName);
  if (!dropText) {
    assignScrubbed(clean, 'text', target.text);
  }
  assignScrubbed(clean, 'testId', target.testId);
  assignScrubbed(clean, 'name', target.name);
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function expurgatePage(
  page: { url?: string; title?: string } | undefined
): { url: string; title?: string } | undefined {
  if (page === undefined) {
    return undefined;
  }
  const url = redactUrl(page.url ?? '');
  const result: { url: string; title?: string } = { url };
  const title = scrubText(page.title);
  if (title !== undefined) {
    result.title = title;
  }
  return result;
}

export function redactUrl(raw: string): string {
  if (raw.length === 0) {
    return '';
  }
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.hash = '';
    const kept = new URLSearchParams();
    url.searchParams.forEach((value, key) => {
      if (!isSensitiveQueryKey(key)) {
        kept.append(key, scrubText(value) ?? '');
      }
    });
    const next = `${url.origin}${url.pathname}`;
    const query = kept.toString();
    return query.length > 0 ? `${next}?${query}` : next;
  } catch {
    return stripUnsafeUrlFallback(raw);
  }
}

export function scrubText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const stripped = value.replace(SECRET_LIKE, '[redacted]').replace(/\s+/g, ' ').trim();
  if (stripped.length === 0) {
    return undefined;
  }
  if (stripped.length <= EXPURGATE_TEXT_MAX) {
    return stripped;
  }
  return `${stripped.slice(0, EXPURGATE_TEXT_MAX)}…`;
}

export function assertNoLeak(payload: unknown, forbidden: readonly string[]): void {
  const blob = JSON.stringify(payload);
  for (const token of forbidden) {
    if (token.length > 0 && blob.includes(token)) {
      throw new Error('expurgation leak');
    }
  }
}

function assignScrubbed(
  target: ExpurgatedTarget,
  key: keyof ExpurgatedTarget,
  value: string | undefined
): void {
  const clean = scrubText(value);
  if (clean !== undefined) {
    target[key] = clean;
  }
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
    return true;
  }
  for (const item of SENSITIVE_QUERY_KEYS) {
    if (normalized.includes(item.replace(/[_-]/g, ''))) {
      return true;
    }
  }
  return false;
}

function stripUnsafeUrlFallback(raw: string): string {
  const noHash = raw.split('#')[0] ?? raw;
  const queryAt = noHash.indexOf('?');
  const base = queryAt === -1 ? noHash : noHash.slice(0, queryAt);
  return scrubText(base) ?? '';
}

function isFieldKind(kind: string): boolean {
  return kind === 'dom.input' || kind === 'dom.change' || kind === 'dom.select' || kind === 'dom.key';
}
