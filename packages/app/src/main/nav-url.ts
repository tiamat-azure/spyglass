import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_USER_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_GUEST_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function hasScheme(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input);
}

function parseUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function hasEmbeddedCredentials(url: URL): boolean {
  return url.username.length > 0 || url.password.length > 0;
}

export function isHttpOrHttpsUrl(input: string): boolean {
  const url = parseUrl(input);
  return url !== undefined && (url.protocol === 'http:' || url.protocol === 'https:');
}

export function isFileUrl(input: string): boolean {
  const url = parseUrl(input);
  return url !== undefined && url.protocol === 'file:';
}

function normalizeContainmentPath(input: string): string {
  const resolved = resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isInsideDir(dir: string, targetPath: string): boolean {
  const root = normalizeContainmentPath(dir);
  const target = normalizeContainmentPath(targetPath);
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function fileUrlToPath(input: string): string | undefined {
  const url = parseUrl(input);
  if (url === undefined || url.protocol !== 'file:') {
    return undefined;
  }
  try {
    return fileURLToPath(url);
  } catch {
    // Windows Node requires a drive letter (`file:///C:/...`). POSIX `file:///app/...`
    // URLs (tests, some Chromium listings) throw; resolve the pathname instead.
    return fileUrlToPathWithoutDrive(url);
  }
}

function fileUrlToPathWithoutDrive(url: URL): string | undefined {
  if (url.hostname.length > 0) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0')) {
      return undefined;
    }
    const native = process.platform === 'win32' ? decoded.replaceAll('/', '\\') : decoded;
    return resolve(native);
  } catch {
    return undefined;
  }
}

export function isAppResourceFileUrl(input: string, resourcesDir: string): boolean {
  const path = fileUrlToPath(input);
  if (path === undefined) {
    return false;
  }
  return isInsideDir(resourcesDir, path);
}

function isAboutBlankUrl(input: string): boolean {
  return input === 'about:blank' || input.startsWith('about:blank');
}

function currentAllowsAppFileNavigation(currentUrl: string): boolean {
  if (currentUrl.length === 0) {
    return true;
  }
  // about:blank after http(s) must not reopen file:// guest resources.
  if (isAboutBlankUrl(currentUrl)) {
    return false;
  }
  return isFileUrl(currentUrl);
}

/**
 * Deny-by-default guest navigation: http(s) always; file: only for app start-page
 * resources, and only when the current guest is not an http(s) page.
 *
 * Main-frame `about:blank` is denied when the current page is http(s) so it
 * cannot trampoline into file:. Subframe blanks (iframes) stay allowed.
 */
export function isAllowedInViewNavigation(
  currentUrl: string,
  nextUrl: string,
  resourcesDir: string,
  isMainFrame = true
): boolean {
  if (isAboutBlankUrl(nextUrl)) {
    if (isMainFrame && isHttpOrHttpsUrl(currentUrl)) {
      return false;
    }
    return true;
  }
  const next = parseUrl(nextUrl);
  if (next === undefined) {
    return false;
  }
  if (next.protocol === 'chrome-error:') {
    return true;
  }
  if (hasEmbeddedCredentials(next)) {
    return false;
  }
  if (isHttpOrHttpsUrl(nextUrl)) {
    return true;
  }
  if (isFileUrl(nextUrl)) {
    return (
      currentAllowsAppFileNavigation(currentUrl) && isAppResourceFileUrl(nextUrl, resourcesDir)
    );
  }
  return false;
}

/**
 * Popup redirect load: same scheme policy as in-view navigation. file: is never
 * loaded via main-process loadURL when the displayed page is http(s).
 */
export function isAllowedPopupRedirect(
  currentUrl: string,
  nextUrl: string,
  resourcesDir: string
): boolean {
  if (isAboutBlankUrl(nextUrl)) {
    return false;
  }
  return isAllowedInViewNavigation(currentUrl, nextUrl, resourcesDir);
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

/**
 * Electron replay `goto`: same http(s) bar as chrome `nav.goto`, plus in-app
 * `file:` guest resources when the current page already allows them (recorded
 * startUrl fixtures). Never javascript:/data:/credentialed URLs.
 */
export function resolveDriverGotoUrl(
  currentUrl: string,
  requested: string,
  resourcesDir: string
): string | undefined {
  const http = normalizeGotoUrl(requested);
  if (http !== undefined) {
    return http;
  }
  const trimmed = requested.trim();
  if (!isFileUrl(trimmed)) {
    return undefined;
  }
  if (isAllowedInViewNavigation(currentUrl, trimmed, resourcesDir)) {
    return trimmed;
  }
  return undefined;
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
