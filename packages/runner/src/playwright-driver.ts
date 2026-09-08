import { resolveReplayGotoUrl } from '@spyglass/llm';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { PageDriver, PageSnapshot } from './driver.ts';

export type PlaywrightLaunchOptions = {
  /** D35b / F-45: headed unless this is exactly `true`. Omitted/false stays visible. */
  headless?: boolean;
  baseUrl?: string;
  trace?: boolean;
  /** Absolute path for Playwright `trace.zip` (F-58). Windows-safe via `runPath`. */
  tracePath?: string;
  executablePath?: string;
  channel?: string;
  cdpUrl?: string;
  env?: NodeJS.ProcessEnv;
};

export class PlaywrightPageDriver implements PageDriver {
  constructor(
    private readonly page: Page,
    private readonly owned:
      | { browser: Browser; context: BrowserContext; stopTrace?: () => Promise<void> }
      | undefined
  ) {}

  async goto(url: string): Promise<void> {
    const allowed = resolveReplayGotoUrl(url);
    if (allowed === undefined) {
      throw new Error('goto rejected disallowed URL');
    }
    await this.page.goto(allowed, { waitUntil: 'domcontentloaded' });
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async click(selector: string): Promise<void> {
    await locate(this.page, selector).click({ timeout: 10_000 });
  }

  async fill(selector: string, value: string): Promise<void> {
    await locate(this.page, selector).fill(value, { timeout: 10_000 });
  }

  async select(selector: string, value: string): Promise<void> {
    await locate(this.page, selector).selectOption(value, { timeout: 10_000 });
  }

  async check(selector: string, checked: boolean): Promise<void> {
    const locator = locate(this.page, selector);
    if (checked) {
      await locator.check({ timeout: 10_000 });
      return;
    }
    await locator.uncheck({ timeout: 10_000 });
  }

  async press(selector: string, key: string): Promise<void> {
    await locate(this.page, selector).press(key, { timeout: 10_000 });
  }

  async scroll(dx: number, dy: number): Promise<void> {
    await this.page.mouse.wheel(dx, dy);
  }

  async waitFor(selector: string, timeoutMs: number): Promise<void> {
    await locate(this.page, selector).waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async isVisible(selector: string): Promise<boolean> {
    try {
      return await locate(this.page, selector).isVisible();
    } catch {
      return false;
    }
  }

  async isAbsent(selector: string): Promise<boolean> {
    return !(await this.isVisible(selector));
  }

  async textContent(): Promise<string> {
    return (
      (await this.page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? ''
    );
  }

  async inputValue(selector: string): Promise<string> {
    try {
      return await locate(this.page, selector).inputValue();
    } catch {
      return '';
    }
  }

  async snapshot(): Promise<PageSnapshot> {
    return {
      url: this.page.url(),
      title: await this.page.title(),
      text: await this.textContent(),
      values: {}
    };
  }

  async screenshot(filePath: string, options?: { fullPage?: boolean }): Promise<void> {
    await this.page.screenshot({
      path: filePath,
      ...screenshotFormatForPath(filePath),
      fullPage: options?.fullPage === true
    });
  }

  async close(): Promise<void> {
    if (this.owned === undefined) {
      return;
    }
    await this.owned.stopTrace?.();
    await this.owned.context.close().catch(() => undefined);
    await this.owned.browser.close().catch(() => undefined);
  }
}

/** Match Playwright `type` to the output extension (L6-018). `.png` → PNG; otherwise JPEG. */
export function screenshotFormatForPath(filePath: string): {
  type: 'png' | 'jpeg';
  quality?: number;
} {
  if (filePath.toLowerCase().endsWith('.png')) {
    return { type: 'png' };
  }
  return { type: 'jpeg', quality: 80 };
}

export function chromiumLaunchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args: string[] = [];
  const ci = env.CI === '1' || env.CI === 'true' || env.CI === 'yes';
  if (env.SPYGLASS_NO_SANDBOX === '1' || ci) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  if (env.SPYGLASS_DISABLE_GPU === '1') {
    args.push('--disable-gpu');
  }
  return args;
}

export async function createPlaywrightDriver(
  options: PlaywrightLaunchOptions = {}
): Promise<PlaywrightPageDriver> {
  const { chromium } = await import('playwright-core');
  const env = options.env ?? process.env;
  if (options.cdpUrl !== undefined && options.cdpUrl.length > 0) {
    const browser = await chromium.connectOverCDP(options.cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return new PlaywrightPageDriver(page, { browser, context });
  }
  // D35b: headed by default; only `headless: true` hides the window (F-45).
  const headless = options.headless === true;
  const args = chromiumLaunchArgs(env);
  const browser = await launchChromium(chromium, {
    headless,
    args,
    env,
    ...(options.executablePath !== undefined ? { executablePath: options.executablePath } : {}),
    ...(options.channel !== undefined ? { channel: options.channel } : {})
  });
  const context = await browser.newContext();
  let stopTrace: (() => Promise<void>) | undefined;
  if (options.trace === true) {
    await context.tracing.start({ screenshots: true, snapshots: true });
    const tracePath = options.tracePath ?? 'trace.zip';
    stopTrace = async () => {
      await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    };
  }
  const page = await context.newPage();
  const owned: { browser: Browser; context: BrowserContext; stopTrace?: () => Promise<void> } = {
    browser,
    context
  };
  if (stopTrace !== undefined) {
    owned.stopTrace = stopTrace;
  }
  return new PlaywrightPageDriver(page, owned);
}

function locate(page: Page, selector: string) {
  const hops = selector
    .split(' >> ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  let frame = page as Pick<Page, 'locator' | 'getByRole'>;
  const last = hops.at(-1) ?? selector;
  for (const hop of hops.slice(0, -1)) {
    frame = page.frameLocator(hop) as unknown as Pick<Page, 'locator' | 'getByRole'>;
  }
  const role = /^role=([^[]+)(?:\[name="([^"]*)"\])?$/u.exec(last);
  if (role?.[1] !== undefined) {
    const name = role[2];
    return name !== undefined
      ? frame.getByRole(role[1] as 'button', { name })
      : frame.getByRole(role[1] as 'button');
  }
  if (last.startsWith('xpath=')) {
    return frame.locator(`xpath=${last.slice('xpath='.length)}`);
  }
  return frame.locator(last);
}

export type ChromiumLaunchAttempt = {
  failFast: boolean;
  label: string;
  launch: {
    headless: boolean;
    args: string[];
    executablePath?: string;
    channel?: string;
  };
};

/** Build the Chromium launch cascade (C36a). Explicit path/channel attempts fail-fast. */
export function chromiumLaunchAttempts(options: {
  headless: boolean;
  args: string[];
  executablePath?: string;
  channel?: string;
  env: NodeJS.ProcessEnv;
}): ChromiumLaunchAttempt[] {
  const base = { headless: options.headless, args: options.args };
  const attempts: ChromiumLaunchAttempt[] = [];
  if (options.executablePath !== undefined && options.executablePath.length > 0) {
    attempts.push({
      failFast: true,
      label: 'executablePath',
      launch: { ...base, executablePath: options.executablePath }
    });
  }
  const envPath = options.env.SPYGLASS_CHROME_PATH;
  if (envPath !== undefined && envPath.length > 0) {
    attempts.push({
      failFast: true,
      label: 'SPYGLASS_CHROME_PATH',
      launch: { ...base, executablePath: envPath }
    });
  }
  if (options.channel !== undefined && options.channel.length > 0) {
    attempts.push({
      failFast: true,
      label: 'channel',
      launch: { ...base, channel: options.channel }
    });
  }
  const envChannel = options.env.SPYGLASS_CHROME_CHANNEL;
  if (envChannel !== undefined && envChannel.length > 0) {
    attempts.push({
      failFast: true,
      label: 'SPYGLASS_CHROME_CHANNEL',
      launch: { ...base, channel: envChannel }
    });
  }
  attempts.push({
    failFast: false,
    label: 'channel=chrome',
    launch: { ...base, channel: 'chrome' }
  });
  attempts.push({ failFast: false, label: 'bundled', launch: { ...base } });
  return attempts;
}

export async function launchChromium(
  chromium: typeof import('playwright-core').chromium,
  options: {
    headless: boolean;
    args: string[];
    executablePath?: string;
    channel?: string;
    env: NodeJS.ProcessEnv;
  }
): Promise<import('playwright-core').Browser> {
  const attempts = chromiumLaunchAttempts(options);
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.launch);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const line = `${attempt.label}: ${detail}`;
      errors.push(line);
      process.stderr.write(`warn: Chromium launch failed (${attempt.label}): ${detail}\n`);
      if (attempt.failFast) {
        throw new Error(`failed to launch Chromium (${attempt.label}): ${detail}`);
      }
    }
  }
  throw new Error(`failed to launch Chromium: ${errors.join('; ')}`);
}
