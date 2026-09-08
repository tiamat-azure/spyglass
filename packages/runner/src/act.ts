import type { ReplayDescriptor } from '@spyglass/contracts';
import type { PageDriver } from './driver.ts';

export function selectorChain(descriptor: ReplayDescriptor): string[] {
  const selectors = [descriptor.selector, ...(descriptor.fallbackSelectors ?? [])];
  const unique: string[] = [];
  for (const selector of selectors) {
    const trimmed = selector.trim();
    if (trimmed.length > 0 && !unique.includes(trimmed)) {
      unique.push(trimmed);
    }
  }
  return unique;
}

export async function performAction(
  driver: PageDriver,
  descriptor: ReplayDescriptor
): Promise<{ ok: true; selector: string } | { ok: false; error: string }> {
  const selectors = selectorChain(descriptor);
  if (selectors.length === 0) {
    return { ok: false, error: 'empty action selector' };
  }
  let lastError = 'action failed';
  for (const selector of selectors) {
    try {
      await dispatch(driver, descriptor, selector);
      return { ok: true, selector };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}

async function dispatch(
  driver: PageDriver,
  descriptor: ReplayDescriptor,
  selector: string
): Promise<void> {
  const args = descriptor.arguments ?? [];
  switch (descriptor.type) {
    case 'click':
      await driver.click(selector);
      return;
    case 'fill':
      await driver.fill(selector, args[0] ?? '');
      return;
    case 'select':
      await driver.select(selector, args[0] ?? '');
      return;
    case 'check':
      await driver.check(selector, args[0] !== 'false');
      return;
    case 'press':
      await driver.press(selector, args[0] ?? 'Enter');
      return;
    case 'navigate':
      await driver.goto(args[0] ?? selector);
      return;
    case 'wait':
      await driver.waitFor(selector, Number.parseInt(args[0] ?? '1000', 10) || 1000);
      return;
    case 'scroll':
      await driver.scroll(Number(args[0] ?? 0), Number(args[1] ?? 0));
      return;
    default:
      throw new Error(`unsupported action ${descriptor.type}`);
  }
}
