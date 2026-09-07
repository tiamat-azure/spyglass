const ALLOWED_USER_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_GUEST_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function hasScheme(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input);
}

export function normalizeGotoUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const withScheme = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!ALLOWED_USER_PROTOCOLS.has(url.protocol)) {
      return undefined;
    }
    if (url.username.length > 0 || url.password.length > 0) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isAllowedGuestUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol === 'javascript:' || url.protocol === 'data:') {
      return false;
    }
    return ALLOWED_GUEST_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function urlsLooselyMatch(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.href === b.href;
  } catch {
    return false;
  }
}
