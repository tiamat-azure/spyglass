/**
 * Same http(s) gate as chrome `normalizeGotoUrl` (no file:, javascript:, credentials).
 * Used to sanitize recovered navigate arguments (L5-ADV-01).
 */
export function normalizeHttpOrHttpsUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
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
