import { describe, expect, it } from 'vitest';
import {
  isAllowedGuestUrl,
  isAllowedInViewNavigation,
  isAllowedPopupRedirect,
  isInsideDir,
  normalizeGotoUrl
} from './nav-url.ts';

describe('normalizeGotoUrl', () => {
  it('adds https when the scheme is missing', () => {
    expect(normalizeGotoUrl('example.com/path')).toBe('https://example.com/path');
  });

  it('accepts http and https', () => {
    expect(normalizeGotoUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeGotoUrl('https://example.com')).toBe('https://example.com/');
  });

  it('rejects non-web schemes from the URL bar', () => {
    expect(normalizeGotoUrl('file:///tmp/secret')).toBeUndefined();
    expect(normalizeGotoUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeGotoUrl('')).toBeUndefined();
  });

  it('rejects embedded credentials', () => {
    expect(normalizeGotoUrl('https://user:pass@example.com')).toBeUndefined();
    expect(normalizeGotoUrl('https://user@example.com/path')).toBeUndefined();
  });
});

describe('isAllowedGuestUrl', () => {
  it('allows http(s) and file at the coarse scheme layer', () => {
    expect(isAllowedGuestUrl('https://example.com')).toBe(true);
    expect(isAllowedGuestUrl('file:///tmp/page.html')).toBe(true);
  });

  it('rejects javascript and data URLs', () => {
    expect(isAllowedGuestUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedGuestUrl('data:text/html,hi')).toBe(false);
  });
});

describe('isAllowedInViewNavigation', () => {
  const resources = '/app/resources';

  it('allows http(s) from any current guest', () => {
    expect(
      isAllowedInViewNavigation('https://example.com/', 'https://example.org/next', resources)
    ).toBe(true);
    expect(isAllowedInViewNavigation('', 'http://localhost:3000/', resources)).toBe(true);
  });

  it('allows app start-page file: only when the current guest is not http(s)', () => {
    expect(
      isAllowedInViewNavigation(
        'file:///app/resources/start.html',
        'file:///app/resources/second.html',
        resources
      )
    ).toBe(true);
    expect(isAllowedInViewNavigation('', 'file:///app/resources/start.html', resources)).toBe(true);
    expect(
      isAllowedInViewNavigation(
        'https://example.com/',
        'file:///app/resources/start.html',
        resources
      )
    ).toBe(false);
  });

  it('rejects file: outside the app resource dir, including ../ escapes', () => {
    expect(
      isAllowedInViewNavigation(
        'file:///app/resources/start.html',
        'file:///tmp/page.html',
        resources
      )
    ).toBe(false);
    expect(
      isAllowedInViewNavigation(
        'file:///app/resources/start.html',
        'file:///app/secret.html',
        resources
      )
    ).toBe(false);
    expect(isInsideDir(resources, '/app/resources/../secret.html')).toBe(false);
  });

  it('rejects javascript and data even when the current page is the start file', () => {
    expect(
      isAllowedInViewNavigation(
        'file:///app/resources/start.html',
        'javascript:alert(1)',
        resources
      )
    ).toBe(false);
    expect(
      isAllowedInViewNavigation('file:///app/resources/start.html', 'data:text/html,hi', resources)
    ).toBe(false);
  });

  it('rejects http(s) URLs with embedded credentials', () => {
    expect(
      isAllowedInViewNavigation(
        'https://example.com/',
        'https://user:pass@example.com/secret',
        resources
      )
    ).toBe(false);
    expect(
      isAllowedInViewNavigation('https://example.com/', 'https://user@evil.example/', resources)
    ).toBe(false);
  });

  it('denies main-frame about:blank when the current guest is http(s), keeps subframe blanks', () => {
    expect(isAllowedInViewNavigation('https://example.com/', 'about:blank', resources, true)).toBe(
      false
    );
    expect(isAllowedInViewNavigation('https://example.com/', 'about:blank#', resources, true)).toBe(
      false
    );
    expect(isAllowedInViewNavigation('https://example.com/', 'about:blank', resources, false)).toBe(
      true
    );
    expect(
      isAllowedInViewNavigation('file:///app/resources/start.html', 'about:blank', resources, true)
    ).toBe(true);
  });

  it('does not allow file: guest resources after an about:blank trampoline', () => {
    expect(
      isAllowedInViewNavigation('about:blank', 'file:///app/resources/start.html', resources)
    ).toBe(false);
  });
});

describe('isAllowedPopupRedirect', () => {
  const resources = '/app/resources';

  it('refuses file: loadURL when the displayed guest is http(s)', () => {
    expect(
      isAllowedPopupRedirect('https://example.com/', 'file:///app/resources/start.html', resources)
    ).toBe(false);
  });

  it('allows same-origin app start-page popups (F-04 start.html → second.html)', () => {
    expect(
      isAllowedPopupRedirect(
        'file:///app/resources/start.html',
        'file:///app/resources/second.html',
        resources
      )
    ).toBe(true);
  });

  it('does not load about:blank via main-process loadURL', () => {
    expect(isAllowedPopupRedirect('https://example.com/', 'about:blank', resources)).toBe(false);
  });

  it('does not loadURL http(s) with embedded credentials', () => {
    expect(
      isAllowedPopupRedirect(
        'https://example.com/',
        'https://user:pass@example.com/next',
        resources
      )
    ).toBe(false);
  });
});
