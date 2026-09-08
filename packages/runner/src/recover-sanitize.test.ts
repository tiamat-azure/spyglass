import { describe, expect, it } from 'vitest';
import { sanitizeRecoveredDescriptor } from './recover-sanitize.ts';

describe('sanitizeRecoveredDescriptor (L5-ADV-01)', () => {
  it('pins recovered type to the failed step (click must not become navigate)', () => {
    const sanitized = sanitizeRecoveredDescriptor(
      { type: 'click', selector: '#broken', selectorStrategy: 'css' },
      {
        type: 'navigate',
        selector: 'javascript:alert(1)',
        arguments: ['javascript:alert(1)']
      }
    );
    expect(sanitized.type).toBe('click');
    expect(sanitized.selector).toBe('javascript:alert(1)');
    expect(sanitized.arguments).toBeUndefined();
  });

  it('keeps the recorded fill value and drops an LLM-injected password', () => {
    const sanitized = sanitizeRecoveredDescriptor(
      { type: 'fill', selector: '#pw', arguments: ['recorded-secret'] },
      { type: 'fill', selector: '#pw', arguments: ['injected-password'] }
    );
    expect(sanitized.type).toBe('fill');
    expect(sanitized.selector).toBe('#pw');
    expect(sanitized.arguments).toEqual(['recorded-secret']);
  });

  it('drops file:// and javascript: navigate args; keeps http(s)', () => {
    const original = {
      type: 'navigate' as const,
      selector: 'https://exemple.test/start',
      arguments: ['https://exemple.test/start']
    };
    const filePoison = sanitizeRecoveredDescriptor(original, {
      type: 'navigate',
      selector: 'file:///etc/passwd',
      arguments: ['file:///etc/passwd']
    });
    expect(filePoison.type).toBe('navigate');
    expect(filePoison.arguments).toEqual(['https://exemple.test/start']);
    expect(filePoison.selector).toBe('https://exemple.test/start');

    const jsPoison = sanitizeRecoveredDescriptor(original, {
      type: 'navigate',
      selector: 'javascript:alert(1)',
      arguments: ['javascript:alert(1)']
    });
    expect(jsPoison.arguments).toEqual(['https://exemple.test/start']);

    const httpsOk = sanitizeRecoveredDescriptor(original, {
      type: 'navigate',
      selector: 'https://exemple.test/next',
      arguments: ['https://exemple.test/next']
    });
    expect(httpsOk.arguments).toEqual(['https://exemple.test/next']);
    expect(httpsOk.selector).toBe('https://exemple.test/next');
  });

  it('rejects credentialed navigate URLs', () => {
    const sanitized = sanitizeRecoveredDescriptor(
      { type: 'navigate', selector: 'https://exemple.test/', arguments: ['https://exemple.test/'] },
      {
        type: 'navigate',
        selector: 'https://user:pass@evil.example/',
        arguments: ['https://user:pass@evil.example/']
      }
    );
    expect(sanitized.arguments).toEqual(['https://exemple.test/']);
  });

  it('does not coerce CSS selectors into https hosts (L5-ADV-06)', () => {
    const original = {
      type: 'navigate' as const,
      selector: 'https://exemple.test/start',
      arguments: ['https://exemple.test/start']
    };
    for (const poison of ['button#confirm', 'div.foo', 'role=button', '#id', '.class', 'button']) {
      const sanitized = sanitizeRecoveredDescriptor(original, {
        type: 'navigate',
        selector: poison,
        arguments: [poison]
      });
      expect(sanitized.arguments, poison).toEqual(['https://exemple.test/start']);
      expect(sanitized.selector, poison).toBe('https://exemple.test/start');
      expect(JSON.stringify(sanitized), poison).not.toMatch(/https:\/\/button/i);
    }
  });
});
