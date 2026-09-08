/**
 * `--base-url` rewrite for F-58.
 *
 * WHATWG `new URL(absolute, base)` ignores `base` when the first argument is
 * already absolute. Real captured scenarios always store an absolute
 * `startUrl`, so staging swaps must rewrite the origin (and optionally prefix
 * a non-root base pathname). Relative `startUrl` still uses WHATWG resolution.
 *
 * - Relative / invalid-as-absolute: `new URL(startUrl, base)`.
 * - Absolute `http(s)` + `http(s)` base: replace origin; if the base pathname
 *   is not `/`, prefix it onto the start path. Query and hash come from start.
 * - `file:` (or any non-http start) vs an http(s) base: leave `startUrl`
 *   unchanged so a staging origin cannot coerce a local file.
 */
export function applyBaseUrl(baseUrl: string | undefined, startUrl: string): string {
  if (baseUrl === undefined || baseUrl.length === 0) {
    return startUrl;
  }
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  } catch {
    return startUrl;
  }

  let start: URL;
  try {
    start = new URL(startUrl);
  } catch {
    try {
      return new URL(startUrl, base).href;
    } catch {
      return startUrl;
    }
  }

  const startHttp = start.protocol === 'http:' || start.protocol === 'https:';
  const baseHttp = base.protocol === 'http:' || base.protocol === 'https:';
  if (!startHttp || !baseHttp) {
    return startUrl;
  }

  const prefix = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/u, '');
  const startPath = start.pathname.startsWith('/') ? start.pathname : `/${start.pathname}`;
  const out = new URL(base.origin);
  out.pathname = prefix.length > 0 ? `${prefix}${startPath}` : startPath;
  out.search = start.search;
  out.hash = start.hash;
  return out.href;
}
