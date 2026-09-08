import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { PlaywrightPageDriver } from './playwright-driver.ts';

describe('PlaywrightPageDriver.goto (L5-ADV-06)', () => {
  function driverWith(): { driver: PlaywrightPageDriver; loaded: string[] } {
    const loaded: string[] = [];
    const page = {
      goto: async (url: string) => {
        loaded.push(url);
      }
    };
    return {
      driver: new PlaywrightPageDriver(page as unknown as Page, undefined),
      loaded
    };
  }

  it('never goto CSS selectors or coerced https://button/', async () => {
    const { driver, loaded } = driverWith();
    await expect(driver.goto('button#confirm')).rejects.toThrow(/rejected/i);
    await expect(driver.goto('div.foo')).rejects.toThrow(/rejected/i);
    await expect(driver.goto('javascript:alert(1)')).rejects.toThrow(/rejected/i);
    expect(loaded).toEqual([]);
  });

  it('goto absolute http(s) and file fixtures', async () => {
    const { driver, loaded } = driverWith();
    await driver.goto('https://exemple.test/next');
    await driver.goto('file:///tmp/page.html');
    expect(loaded[0]).toBe('https://exemple.test/next');
    expect(loaded[1]).toMatch(/^file:/);
  });
});
