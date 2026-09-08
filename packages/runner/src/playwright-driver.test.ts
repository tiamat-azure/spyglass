import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import {
  chromiumLaunchArgs,
  PlaywrightPageDriver,
  screenshotFormatForPath
} from './playwright-driver.ts';

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

describe('screenshotFormatForPath (L6-018)', () => {
  it('uses PNG for .png paths and JPEG+quality for .jpg failure shots', () => {
    expect(screenshotFormatForPath('/tmp/headed-run.png')).toEqual({ type: 'png' });
    expect(screenshotFormatForPath('docs/lot-6/screenshots/TREE.PNG')).toEqual({ type: 'png' });
    expect(screenshotFormatForPath('step-1-fail.jpg')).toEqual({ type: 'jpeg', quality: 80 });
  });

  it('PlaywrightPageDriver.screenshot forwards type png without jpeg quality', async () => {
    const calls: unknown[] = [];
    const page = {
      screenshot: async (opts: unknown) => {
        calls.push(opts);
      }
    };
    const driver = new PlaywrightPageDriver(page as unknown as Page, undefined);
    await driver.screenshot('/tmp/evidence.png');
    await driver.screenshot('/tmp/step-1-fail.jpg');
    expect(calls[0]).toMatchObject({ path: '/tmp/evidence.png', type: 'png', fullPage: false });
    expect(calls[0]).not.toHaveProperty('quality');
    expect(calls[1]).toMatchObject({
      path: '/tmp/step-1-fail.jpg',
      type: 'jpeg',
      quality: 80,
      fullPage: false
    });
  });
});

describe('chromiumLaunchArgs (Lot 6 CI / sandbox)', () => {
  it('adds no-sandbox and disable-gpu from env without path separators', () => {
    const args = chromiumLaunchArgs({ CI: '1', SPYGLASS_DISABLE_GPU: '1' });
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-gpu');
    expect(args.every((arg) => !arg.includes('\\') && !arg.includes('/'))).toBe(true);
  });
});
