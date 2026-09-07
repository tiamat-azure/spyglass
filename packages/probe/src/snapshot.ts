export type LightweightSnapshot = {
  url: string;
  title: string;
  interactive: Array<{
    tag: string;
    role?: string;
    name?: string;
    testId?: string;
    framePath: string[];
    shadowPath: string[];
  }>;
  headings: Array<{ level: number; text: string }>;
};

export function snapshotScript(framePath: string[]): string {
  return `(${collectSnapshot.toString()})(${JSON.stringify(framePath)})`;
}

export function collectSnapshot(framePath: string[]): LightweightSnapshot {
  const interactive: LightweightSnapshot['interactive'] = [];
  const headings: LightweightSnapshot['headings'] = [];
  const seen = new Set<Element>();

  const visit = (root: Document | ShadowRoot, shadow: string[]): void => {
    const nodes = root.querySelectorAll(
      'a,button,input,select,textarea,[role],[tabindex],h1,h2,h3,h4,h5,h6'
    );
    for (const node of nodes) {
      if (seen.has(node)) {
        continue;
      }
      seen.add(node);
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = (node.textContent ?? '').trim().slice(0, 200);
        if (text.length > 0) {
          headings.push({ level: Number(tag.slice(1)), text });
        }
      }
      const role = node.getAttribute('role') ?? undefined;
      const testId = node.getAttribute('data-testid') ?? undefined;
      const name =
        node.getAttribute('aria-label') ??
        (node instanceof HTMLInputElement ||
        node instanceof HTMLButtonElement ||
        node instanceof HTMLTextAreaElement
          ? node.labels?.[0]?.innerText
          : undefined) ??
        (node.textContent ?? '').trim().slice(0, 120);
      const isInteractive =
        ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
        role === 'button' ||
        role === 'link' ||
        role === 'textbox' ||
        node.getAttribute('tabindex') !== null;
      if (isInteractive) {
        const item: LightweightSnapshot['interactive'][number] = {
          tag,
          framePath,
          shadowPath: shadow
        };
        if (role !== undefined) {
          item.role = role;
        }
        if (name !== undefined && name.length > 0) {
          item.name = name;
        }
        if (testId !== undefined && testId.length > 0) {
          item.testId = testId;
        }
        interactive.push(item);
      }
      if (node.shadowRoot) {
        const hostSel =
          node.id.length > 0
            ? `#${node.id}`
            : node.getAttribute('data-testid') !== null
              ? `[data-testid="${node.getAttribute('data-testid')}"]`
              : tag;
        visit(node.shadowRoot, [...shadow, hostSel]);
      }
    }
  };

  visit(document, []);
  return {
    url: location.href,
    title: document.title,
    interactive: interactive.slice(0, 200),
    headings: headings.slice(0, 40)
  };
}
