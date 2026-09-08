import type { PageDriver, PageSnapshot } from './driver.ts';

export type MemoryElement = {
  selector: string;
  visible: boolean;
  text?: string;
  value?: string;
  tag?: string;
  href?: string;
};

export type MemoryPageDriverOptions = {
  url?: string;
  title?: string;
  text?: string;
  elements?: MemoryElement[];
  screenshotWrites?: string[];
};

/**
 * In-memory page for unit tests. No browser, no network, no API keys.
 */
export class MemoryPageDriver implements PageDriver {
  urlValue: string;
  titleValue: string;
  pageText: string;
  readonly elements: Map<string, MemoryElement>;
  readonly screenshotWrites: string[];
  readonly clicks: string[] = [];
  readonly fills: Array<{ selector: string; value: string }> = [];
  failSelectors = new Set<string>();
  closed = false;

  constructor(options: MemoryPageDriverOptions = {}) {
    this.urlValue = options.url ?? 'https://exemple.test/';
    this.titleValue = options.title ?? 'Spyglass fixture';
    this.pageText = options.text ?? '';
    this.elements = new Map();
    for (const element of options.elements ?? []) {
      this.elements.set(element.selector, { ...element });
    }
    this.screenshotWrites = options.screenshotWrites ?? [];
  }

  setElement(element: MemoryElement): void {
    this.elements.set(element.selector, { ...element });
  }

  removeElement(selector: string): void {
    this.elements.delete(selector);
  }

  async goto(url: string): Promise<void> {
    this.urlValue = url;
  }

  async url(): Promise<string> {
    return this.urlValue;
  }

  async title(): Promise<string> {
    return this.titleValue;
  }

  async click(selector: string): Promise<void> {
    this.requirePresent(selector);
    this.clicks.push(selector);
  }

  async fill(selector: string, value: string): Promise<void> {
    const element = this.requirePresent(selector);
    element.value = value;
    this.fills.push({ selector, value });
  }

  async select(selector: string, value: string): Promise<void> {
    await this.fill(selector, value);
  }

  async check(selector: string, checked: boolean): Promise<void> {
    const element = this.requirePresent(selector);
    element.value = checked ? 'true' : 'false';
  }

  async press(selector: string, key: string): Promise<void> {
    this.requirePresent(selector);
    this.clicks.push(`${selector}::${key}`);
  }

  async scroll(): Promise<void> {
    // no-op in memory
  }

  async waitFor(selector: string, timeoutMs: number): Promise<void> {
    if (this.elements.has(selector) && !this.failSelectors.has(selector)) {
      return;
    }
    throw new Error(`waitFor timed out after ${String(timeoutMs)}ms: ${selector}`);
  }

  async isVisible(selector: string): Promise<boolean> {
    const element = this.elements.get(selector);
    return Boolean(element?.visible) && !this.failSelectors.has(selector);
  }

  async isAbsent(selector: string): Promise<boolean> {
    return !(await this.isVisible(selector));
  }

  async textContent(): Promise<string> {
    const parts = [this.pageText];
    for (const element of this.elements.values()) {
      if (element.visible && element.text !== undefined) {
        parts.push(element.text);
      }
    }
    return parts.join(' ');
  }

  async inputValue(selector: string): Promise<string> {
    return this.elements.get(selector)?.value ?? '';
  }

  async snapshot(): Promise<PageSnapshot> {
    const values: Record<string, string> = {};
    for (const [selector, element] of this.elements) {
      if (element.value !== undefined) {
        values[selector] = element.value;
      }
    }
    return {
      url: this.urlValue,
      title: this.titleValue,
      text: await this.textContent(),
      values
    };
  }

  async screenshot(filePath: string): Promise<void> {
    this.screenshotWrites.push(filePath);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private requirePresent(selector: string): MemoryElement {
    if (this.failSelectors.has(selector)) {
      throw new Error(`selector not found: ${selector}`);
    }
    const element = this.elements.get(selector);
    if (element === undefined || !element.visible) {
      throw new Error(`selector not found: ${selector}`);
    }
    return element;
  }
}
