import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import {
  chromiumLaunchArgs,
  chromiumLaunchAttempts,
  launchChromium,
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
    await driver.screenshot({ path: '/tmp/headed-run.png' });
    await driver.screenshot('/tmp/step-1-fail.jpg');
    expect(calls[0]).toMatchObject({ path: '/tmp/evidence.png', type: 'png', fullPage: false });
    expect(calls[0]).not.toHaveProperty('quality');
    expect(calls[1]).toMatchObject({ path: '/tmp/headed-run.png', type: 'png', fullPage: false });
    expect(calls[2]).toMatchObject({
      path: '/tmp/step-1-fail.jpg',
      type: 'jpeg',
      quality: 80,
      fullPage: false
    });
  });
});

describe('chromiumLaunchArgs (Lot 6 CI / sandbox)', () => {
  function captureStderr(env: NodeJS.ProcessEnv): { args: string[]; stderr: string } {
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      return { args: chromiumLaunchArgs(env), stderr: chunks.join('') };
    } finally {
      process.stderr.write = write;
    }
  }

  it('adds no-sandbox and disable-gpu from env without path separators', () => {
    const { args, stderr } = captureStderr({ CI: '1', SPYGLASS_DISABLE_GPU: '1' });
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-setuid-sandbox');
    expect(args).toContain('--disable-gpu');
    expect(args.every((arg) => !arg.includes('\\') && !arg.includes('/'))).toBe(true);
    expect(stderr).toMatch(/sandbox disabled/);
    expect(stderr).toMatch(/CI/);
  });

  it('warns on stderr for CI-derived and explicit no-sandbox (N52b / L6-052)', () => {
    const ciOnly = captureStderr({ CI: 'true' });
    expect(ciOnly.args).toContain('--no-sandbox');
    expect(ciOnly.stderr).toMatch(/sandbox disabled/);
    expect(ciOnly.stderr).toMatch(/CI/);
    expect(ciOnly.stderr).not.toMatch(/SPYGLASS_NO_SANDBOX/);

    const explicit = captureStderr({ SPYGLASS_NO_SANDBOX: '1' });
    expect(explicit.args).toContain('--no-sandbox');
    expect(explicit.stderr).toMatch(/sandbox disabled/);
    expect(explicit.stderr).toMatch(/SPYGLASS_NO_SANDBOX/);

    const both = captureStderr({ CI: '1', SPYGLASS_NO_SANDBOX: '1' });
    expect(both.args).toContain('--no-sandbox');
    expect(both.stderr).toMatch(/CI/);
    expect(both.stderr).toMatch(/SPYGLASS_NO_SANDBOX/);

    const none = captureStderr({});
    expect(none.args).not.toContain('--no-sandbox');
    expect(none.stderr).toBe('');
  });
});

describe('createPlaywrightDriver headless (D35b)', () => {
  it('treats omitted and false headless as headed; only true is headless', () => {
    const src = chromiumLaunchAttempts({ headless: false, args: [], env: {} });
    expect(src[0]?.launch.headless).toBe(false);
    expect(chromiumLaunchAttempts({ headless: true, args: [], env: {} })[0]?.launch.headless).toBe(
      true
    );
  });
});

describe('launchChromium cascade (C36a)', () => {
  it('fail-fast on SPYGLASS_CHROME_PATH without falling through', async () => {
    const plan = chromiumLaunchAttempts({
      headless: true,
      args: [],
      env: { SPYGLASS_CHROME_PATH: '/nope/chrome' }
    });
    expect(plan[0]).toMatchObject({ failFast: true, label: 'SPYGLASS_CHROME_PATH' });
    expect(plan.some((row) => row.label === 'bundled')).toBe(true);
    const launches: unknown[] = [];
    const chromium = {
      launch: async (opts: unknown) => {
        launches.push(opts);
        throw new Error('missing binary');
      }
    };
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      await expect(
        launchChromium(chromium as never, {
          headless: true,
          args: [],
          env: { SPYGLASS_CHROME_PATH: '/nope/chrome' }
        })
      ).rejects.toThrow(/SPYGLASS_CHROME_PATH/);
    } finally {
      process.stderr.write = write;
    }
    expect(launches).toHaveLength(1);
    expect(chunks.join('')).toMatch(/SPYGLASS_CHROME_PATH/);
  });

  it('fail-fast on explicit channel', async () => {
    const launches: unknown[] = [];
    const chromium = {
      launch: async (opts: unknown) => {
        launches.push(opts);
        throw new Error('no channel');
      }
    };
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      await expect(
        launchChromium(chromium as never, {
          headless: true,
          args: [],
          channel: 'chrome-beta',
          env: {}
        })
      ).rejects.toThrow(/channel/);
    } finally {
      process.stderr.write = write;
    }
    expect(launches).toHaveLength(1);
  });
});
