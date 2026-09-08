import { writeFile } from 'node:fs/promises';
import type { PageDriver, PageSnapshot } from '@spyglass/runner';
import type { WebContents } from 'electron';
import { guestScript } from './electron-guest-script.ts';
import { resolveDriverGotoUrl } from './nav-url.ts';

export { guestScript } from './electron-guest-script.ts';

export class ElectronPageDriver implements PageDriver {
  constructor(
    private readonly contents: WebContents,
    private readonly resourcesDir: string
  ) {}

  async goto(url: string): Promise<void> {
    const allowed = resolveDriverGotoUrl(this.contents.getURL(), url, this.resourcesDir);
    if (allowed === undefined) {
      throw new Error(`goto rejected disallowed URL`);
    }
    await this.contents.loadURL(allowed);
  }

  async url(): Promise<string> {
    return this.contents.getURL();
  }

  async title(): Promise<string> {
    return this.contents.getTitle();
  }

  async click(selector: string): Promise<void> {
    await this.eval(
      guestScript(`
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.click();
      return true;`)
    );
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.eval(
      guestScript(`
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;`)
    );
  }

  async select(selector: string, value: string): Promise<void> {
    await this.fill(selector, value);
  }

  async check(selector: string, checked: boolean): Promise<void> {
    await this.eval(
      guestScript(`
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.checked = ${checked ? 'true' : 'false'};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;`)
    );
  }

  async press(selector: string, key: string): Promise<void> {
    await this.eval(
      guestScript(`
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      return true;`)
    );
  }

  async scroll(_dx: number, dy: number): Promise<void> {
    await this.eval(`window.scrollBy(0, ${String(dy)}); true;`);
  }

  async waitFor(selector: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isVisible(selector)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`waitFor timed out: ${selector}`);
  }

  async isVisible(selector: string): Promise<boolean> {
    try {
      const result = await this.eval(
        guestScript(`
        const el = spyglassQuery(${JSON.stringify(selector)});
        if (!el) { return false; }
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';`)
      );
      return result === true;
    } catch {
      return false;
    }
  }

  async isAbsent(selector: string): Promise<boolean> {
    return !(await this.isVisible(selector));
  }

  async textContent(): Promise<string> {
    const text = await this.eval('document.body ? document.body.innerText : ""');
    return typeof text === 'string' ? text : '';
  }

  async inputValue(selector: string): Promise<string> {
    const value = await this.eval(
      guestScript(`
      const el = spyglassQuery(${JSON.stringify(selector)});
      return el && 'value' in el ? String(el.value) : '';`)
    );
    return typeof value === 'string' ? value : '';
  }

  async snapshot(): Promise<PageSnapshot> {
    return {
      url: this.contents.getURL(),
      title: this.contents.getTitle(),
      text: await this.textContent(),
      values: {}
    };
  }

  async screenshot(filePath: string): Promise<void> {
    const image = await this.contents.capturePage();
    await writeFile(filePath, image.toJPEG(70));
  }

  async close(): Promise<void> {
    // Guest WebContents is owned by the BrowserPane.
  }

  private async eval(script: string): Promise<unknown> {
    try {
      return await this.contents.executeJavaScript(script, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nested = /Error: ([^\n]+)/u.exec(message);
      throw new Error(nested?.[1] ?? message);
    }
  }
}
