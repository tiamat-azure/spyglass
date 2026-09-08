import type { RefinedStep } from '@spyglass/contracts';
import type { PageDriver } from './driver.ts';

export type VerifyResult = { ok: true } | { ok: false; error: string };

function globToRegExp(glob: string): RegExp | undefined {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/gu, '\\$&').replace(/\*\*/gu, '::GLOBSTAR::');
  const withSingles = escaped.replace(/\*/gu, '[^/]*').replace(/::GLOBSTAR::/gu, '.*');
  try {
    return new RegExp(`^${withSingles}$`);
  } catch {
    return undefined;
  }
}

/** `*`, `**`, empty, separator-only wildcards, or globs that match any hierarchical URL. */
export function isDegenerateUrlPattern(expected: string): boolean {
  const trimmed = expected.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const stripped = trimmed.replaceAll('*', '').replaceAll(/\s/g, '');
  if (stripped.length === 0) {
    return true;
  }
  const leftover = stripped.replaceAll(/[/:.]/g, '');
  if (leftover.length === 0) {
    return true;
  }
  const re = globToRegExp(trimmed);
  if (re === undefined) {
    return true;
  }
  return NEAR_UNIVERSAL_URL_PROBES.every((url) => re.test(url));
}

const NEAR_UNIVERSAL_URL_PROBES = [
  'https://exemple.test/login',
  'https://other.example.org/a/b/c?q=1',
  'http://localhost:3000/path',
  'file:///tmp/workspace/page.html'
] as const;

export async function verifyStep(
  driver: PageDriver,
  step: RefinedStep,
  timeoutMs: number
): Promise<VerifyResult> {
  const expected = step.verification.expected;
  const type = step.verification.type;
  if (type === 'urlMatches' && isDegenerateUrlPattern(expected)) {
    return { ok: false, error: `urlMatches rejected degenerate pattern: ${expected}` };
  }
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let lastError = 'verification failed';
  while (Date.now() <= deadline) {
    const result = await checkOnce(driver, type, expected);
    if (result.ok) {
      return result;
    }
    lastError = result.error;
    await sleep(40);
  }
  return { ok: false, error: lastError };
}

async function checkOnce(
  driver: PageDriver,
  type: RefinedStep['verification']['type'],
  expected: string
): Promise<VerifyResult> {
  switch (type) {
    case 'urlMatches': {
      const url = await driver.url();
      const re = globToRegExp(expected);
      if (re === undefined) {
        return { ok: false, error: `urlMatches invalid pattern: ${expected}` };
      }
      if (re.test(url)) {
        return { ok: true };
      }
      return { ok: false, error: `urlMatches expected ${expected}, got ${url}` };
    }
    case 'elementVisible': {
      const visible = await driver.isVisible(expected);
      return visible ? { ok: true } : { ok: false, error: `elementVisible failed: ${expected}` };
    }
    case 'elementAbsent': {
      const absent = await driver.isAbsent(expected);
      return absent ? { ok: true } : { ok: false, error: `elementAbsent failed: ${expected}` };
    }
    case 'textPresent': {
      const text = await driver.textContent();
      return text.includes(expected)
        ? { ok: true }
        : { ok: false, error: `textPresent failed: ${expected}` };
    }
    case 'valueEquals': {
      const [selector, value] = splitValueEquals(expected);
      const actual = await driver.inputValue(selector);
      return actual === value
        ? { ok: true }
        : { ok: false, error: `valueEquals expected ${value} on ${selector}, got ${actual}` };
    }
    default:
      return { ok: false, error: `unknown verification ${type}` };
  }
}

function splitValueEquals(expected: string): [string, string] {
  const eq = expected.indexOf('=');
  if (eq <= 0) {
    return [expected, expected];
  }
  return [expected.slice(0, eq), expected.slice(eq + 1)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
