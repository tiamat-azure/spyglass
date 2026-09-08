import { writeFile } from 'node:fs/promises';
import type { PageDriver, PageSnapshot } from '@spyglass/runner';
import type { WebContents } from 'electron';

const QUERY_HELPER = `function spyglassQuery(selector) {
  const hops = String(selector).split(' >> ').map((part) => part.trim()).filter(Boolean);
  let root = document;
  for (let i = 0; i < hops.length - 1; i += 1) {
    const host = spyglassQueryDeep(root, hops[i]);
    if (host == null || host.contentDocument == null) {
      return null;
    }
    root = host.contentDocument;
  }
  return spyglassQueryDeep(root, hops[hops.length - 1] ?? selector);
}
function spyglassQueryDeep(root, selector) {
  if (selector.startsWith('xpath=')) {
    const found = root.evaluate(
      selector.slice(6),
      root,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    return found;
  }
  const role = /^role=([^\\[]+)(?:\\[name="([^"]*)"\\])?$/.exec(selector);
  if (role) {
    const nodes = root.querySelectorAll('*');
    for (const node of nodes) {
      const name = (node.getAttribute('aria-label') || node.textContent || '').trim();
      const computed = (node.getAttribute('role') || node.tagName).toLowerCase();
      if (computed === role[1].toLowerCase() && (!role[2] || name === role[2])) {
        return node;
      }
    }
  }
  try {
    const direct = root.querySelector(selector);
    if (direct) {
      return direct;
    }
  } catch {
    // invalid CSS — try shadow pierce below
  }
  const walk = root.querySelectorAll('*');
  for (const node of walk) {
    if (node.shadowRoot) {
      const nested = spyglassQueryDeep(node.shadowRoot, selector);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}`;

export class ElectronPageDriver implements PageDriver {
  constructor(private readonly contents: WebContents) {}

  async goto(url: string): Promise<void> {
    await this.contents.loadURL(url);
  }

  async url(): Promise<string> {
    return this.contents.getURL();
  }

  async title(): Promise<string> {
    return this.contents.getTitle();
  }

  async click(selector: string): Promise<void> {
    await this.eval(
      `${QUERY_HELPER}
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.click();
      true;`
    );
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.eval(
      `${QUERY_HELPER}
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      true;`
    );
  }

  async select(selector: string, value: string): Promise<void> {
    await this.fill(selector, value);
  }

  async check(selector: string, checked: boolean): Promise<void> {
    await this.eval(
      `${QUERY_HELPER}
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.checked = ${checked ? 'true' : 'false'};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      true;`
    );
  }

  async press(selector: string, key: string): Promise<void> {
    await this.eval(
      `${QUERY_HELPER}
      const el = spyglassQuery(${JSON.stringify(selector)});
      if (!el) { throw new Error(${JSON.stringify(`selector not found: ${selector}`)}); }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      true;`
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
        `${QUERY_HELPER}
        const el = spyglassQuery(${JSON.stringify(selector)});
        if (!el) { return false; }
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';`
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
      `${QUERY_HELPER}
      const el = spyglassQuery(${JSON.stringify(selector)});
      return el && 'value' in el ? String(el.value) : '';`
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
    return await this.contents.executeJavaScript(script, true);
  }
}
