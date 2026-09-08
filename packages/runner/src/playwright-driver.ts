import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { PageDriver, PageSnapshot } from './driver.ts';

export type PlaywrightLaunchOptions = {
  headless?: boolean;
  baseUrl?: string;
  trace?: boolean;
  /** Absolute path for Playwright `trace.zip` (F-58). Windows-safe via `runPath`. */
  tracePath?: string;
  executablePath?: string;
  channel?: string;
  cdpUrl?: string;
};

export class PlaywrightPageDriver implements PageDriver {
  constructor(
    private readonly page: Page,
    private readonly owned:
      | { browser: Browser; context: BrowserContext; stopTrace?: () => Promise<void> }
      | undefined
  ) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
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

  async screenshot(filePath: string): Promise<void> {
    await this.page.screenshot({ path: filePath, type: 'jpeg', quality: 70 });
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

export async function createPlaywrightDriver(
  options: PlaywrightLaunchOptions = {}
): Promise<PlaywrightPageDriver> {
  const { chromium } = await import('playwright-core');
  if (options.cdpUrl !== undefined && options.cdpUrl.length > 0) {
    const browser = await chromium.connectOverCDP(options.cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return new PlaywrightPageDriver(page, { browser, context });
  }
  const launch: Parameters<typeof chromium.launch>[0] = {
    headless: options.headless !== false
  };
  if (options.executablePath !== undefined) {
    launch.executablePath = options.executablePath;
  } else if (options.channel !== undefined) {
    launch.channel = options.channel;
  } else if (process.env.SPYGLASS_CHROME_PATH !== undefined) {
    launch.executablePath = process.env.SPYGLASS_CHROME_PATH;
  } else {
    launch.channel = process.env.SPYGLASS_CHROME_CHANNEL ?? 'chrome';
  }
  const browser = await chromium.launch(launch);
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
