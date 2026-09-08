/**
 * Recovery / replay http(s) gate (L5-ADV-01, L5-ADV-06).
 * Unlike chrome `normalizeGotoUrl`, this does **not** prepend `https://` to
 * schemeless strings — CSS/observe selectors must not become `https://button/`.
 */

const HTML_TAGS = new Set([
  'a',
  'article',
  'aside',
  'body',
  'button',
  'canvas',
  'div',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'html',
  'iframe',
  'img',
  'input',
  'label',
  'li',
  'main',
  'nav',
  'option',
  'p',
  'section',
  'select',
  'span',
  'svg',
  'table',
  'td',
  'textarea',
  'th',
  'tr',
  'ul',
  'video'
]);

function hasHttpOrHttpsScheme(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

/** CSS / role / xpath selectors that must never be coerced into http(s) hosts. */
export function looksLikeCssSelector(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (hasHttpOrHttpsScheme(trimmed) || /^file:/i.test(trimmed)) {
    return false;
  }
  if (/^[.#[]/.test(trimmed)) {
    return true;
  }
  if (/^xpath=/i.test(trimmed) || trimmed.startsWith('//')) {
    return true;
  }
  if (/^role=/i.test(trimmed)) {
    return true;
  }
  if (trimmed.includes('=')) {
    return true;
  }
  if (/[>+~[\]]/.test(trimmed) || /\s/.test(trimmed)) {
    return true;
  }
  if (/^[A-Za-z][\w-]*#/.test(trimmed)) {
    return true;
  }
  if (/^[A-Za-z][\w-]*\[[^\]]+\]/.test(trimmed)) {
    return true;
  }
  const tag = /^([A-Za-z][\w-]*)/u.exec(trimmed)?.[1]?.toLowerCase();
  if (tag !== undefined && HTML_TAGS.has(tag)) {
    const rest = trimmed.slice(tag.length);
    if (rest.length === 0 || rest.startsWith('.') || rest.startsWith('#') || rest.startsWith('[')) {
      return true;
    }
  }
  return false;
}

/**
 * Accept only already-absolute `http:` / `https:` URLs. No schemeless prepend.
 * Rejects credentials, non-web schemes, and CSS/observe selectors.
 */
export function normalizeHttpOrHttpsUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0 || looksLikeCssSelector(trimmed)) {
    return undefined;
  }
  if (!hasHttpOrHttpsScheme(trimmed)) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
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

/**
 * Playwright replay `goto`: absolute http(s), or `file:` fixtures.
 * Never javascript:/selectors/credentialed URLs.
 */
export function resolveReplayGotoUrl(input: string): string | undefined {
  const http = normalizeHttpOrHttpsUrl(input);
  if (http !== undefined) {
    return http;
  }
  const trimmed = input.trim();
  if (looksLikeCssSelector(trimmed)) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'file:') {
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
