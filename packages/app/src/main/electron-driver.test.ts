import type { WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import { ElectronPageDriver } from './electron-driver.ts';
import { guestScript } from './electron-guest-script.ts';

describe('ElectronPageDriver guest scripts', () => {
  it('wraps query helpers so top-level return is valid (isVisible)', () => {
    const script = guestScript(`
      const el = spyglassQuery('#step-1');
      if (!el) { return false; }
      return true;
    `);
    expect(() => new Function(script)).not.toThrow();
    expect(script.startsWith('(() => {')).toBe(true);
  });
});

describe('ElectronPageDriver.goto (L5-ADV-01)', () => {
  function driverWith(current: string): { driver: ElectronPageDriver; loaded: string[] } {
    const loaded: string[] = [];
    const contents = {
      getURL: () => current,
      loadURL: async (url: string) => {
        loaded.push(url);
      }
    };
    return {
      driver: new ElectronPageDriver(contents as unknown as WebContents, '/app/resources'),
      loaded
    };
  }

  it('never loadURL javascript: or escaped file:', async () => {
    const js = driverWith('https://exemple.test/');
    await expect(js.driver.goto('javascript:alert(1)')).rejects.toThrow(/rejected/i);
    expect(js.loaded).toEqual([]);

    const fileEscape = driverWith('file:///app/resources/start.html');
    await expect(fileEscape.driver.goto('file:///tmp/secret.html')).rejects.toThrow(/rejected/i);
    expect(fileEscape.loaded).toEqual([]);
  });

  it('loadURL http(s) and in-app file: resources only', async () => {
    const http = driverWith('https://exemple.test/');
    await http.driver.goto('https://exemple.test/next');
    expect(http.loaded).toEqual(['https://exemple.test/next']);

    const fileOk = driverWith('file:///app/resources/start.html');
    await fileOk.driver.goto('file:///app/resources/lot1-fixture.html');
    expect(fileOk.loaded).toEqual(['file:///app/resources/lot1-fixture.html']);
  });
});
