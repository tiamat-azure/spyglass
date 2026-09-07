export type ProbeInjectConfig = {
  nonce: string;
  inputAggregationMs: number;
  scrollThresholdPx: number;
  framePath: string[];
};

/**
 * Self-contained page-world probe. Stringified into the guest (and every iframe).
 * Passive: capture-phase listeners, never preventDefault / stopPropagation.
 * No guessable globals: install flag is `nonce`-suffixed and non-enumerable.
 * Must not close over module bindings — `Function.prototype.toString` is the
 * injectable source, so imported constants would be ReferenceErrors in the page.
 */
export function spyglassProbeMain(config: ProbeInjectConfig): void {
  const flag = `__s${config.nonce}`;
  if (Object.hasOwn(window, flag)) {
    return;
  }
  Object.defineProperty(window, flag, {
    value: 1,
    enumerable: false,
    configurable: false,
    writable: false
  });

  const TEXT_MAX = 512;
  let scrollAccum = 0;
  const inputTimers = new Map<EventTarget, number>();
  const inputLatest = new Map<EventTarget, Record<string, unknown>>();

  const emit = (payload: Record<string, unknown>): void => {
    try {
      console.log(`SPYGLASS:${config.nonce}:${JSON.stringify(payload)}`);
    } catch {
      // never throw into the page
    }
  };

  const framePath = (): string[] => {
    if (Array.isArray(config.framePath) && config.framePath.length > 0) {
      return config.framePath;
    }
    if (window === window.top) {
      return ['main'];
    }
    try {
      const fe = window.frameElement;
      if (fe instanceof HTMLIFrameElement) {
        if (fe.id) {
          return ['main', `iframe#${fe.id}`];
        }
        const testId = fe.getAttribute('data-testid');
        if (testId) {
          return ['main', `iframe[data-testid="${testId}"]`];
        }
        if (fe.name) {
          return ['main', `iframe[name="${fe.name}"]`];
        }
      }
    } catch {
      // cross-origin
    }
    return ['main', 'iframe'];
  };

  const cssEscapeIdent = (value: string): string =>
    value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const composedElement = (event: Event): Element | undefined => {
    const path = event.composedPath();
    for (const node of path) {
      if (node instanceof Element) {
        return node;
      }
    }
    const target = event.target;
    return target instanceof Element ? target : undefined;
  };

  const shadowPathFor = (el: Element): string[] => {
    const parts: string[] = [];
    let node: Node | null = el;
    while (node) {
      const root: Node = node.getRootNode();
      if (root instanceof ShadowRoot) {
        const host: Element = root.host;
        if (host.id) {
          parts.unshift(`#${host.id}`);
        } else {
          const testId = host.getAttribute('data-testid');
          parts.unshift(
            testId ? `[data-testid="${cssEscapeIdent(testId)}"]` : host.tagName.toLowerCase()
          );
        }
        node = host;
      } else {
        break;
      }
    }
    return parts;
  };

  const testAttrs = (el: Element): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith('data-test') || attr === 'data-qa' || attr === 'data-cy') {
        const value = el.getAttribute(attr);
        if (value !== null) {
          out[attr] = value;
        }
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const accessibleName = (el: Element): string | undefined => {
    const labelled = el.getAttribute('aria-label');
    if (labelled) {
      return labelled.slice(0, TEXT_MAX);
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLButtonElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      const label = el.labels?.[0]?.innerText?.trim();
      if (label) {
        return label.slice(0, TEXT_MAX);
      }
    }
    return undefined;
  };

  const uniqueCss = (el: Element): string | undefined => {
    const root = el.getRootNode();
    const scope: ParentNode =
      root instanceof Document || root instanceof ShadowRoot ? root : document;
    if (el.id && scope.querySelectorAll(`#${cssEscapeIdent(el.id)}`).length === 1) {
      return `#${el.id}`;
    }
    const testId = el.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${cssEscapeIdent(testId)}"]`;
    }
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute('name');
    if (name && scope.querySelectorAll(`${tag}[name="${cssEscapeIdent(name)}"]`).length === 1) {
      return `${tag}[name="${cssEscapeIdent(name)}"]`;
    }
    const parent = el.parentElement;
    if (parent === null) {
      return tag;
    }
    const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
    const index = siblings.indexOf(el) + 1;
    const parentSel = uniqueCss(parent) ?? parent.tagName.toLowerCase();
    return `${parentSel} > ${tag}:nth-of-type(${String(index)})`;
  };

  const xpathFor = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent === null) {
        parts.unshift(`/${tag}`);
        break;
      }
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === node?.tagName
      );
      const index = siblings.indexOf(node) + 1;
      parts.unshift(`${tag}[${String(index)}]`);
      node = parent;
      if (node.getRootNode() instanceof ShadowRoot) {
        break;
      }
    }
    return `/${parts.join('/')}`.replace(/^\/\//, '/');
  };

  const describe = (el: Element): Record<string, unknown> => {
    const tag = el.tagName.toLowerCase();
    const desc: Record<string, unknown> = {
      tag,
      framePath: framePath(),
      shadowPath: shadowPathFor(el)
    };
    if (el.id) {
      desc.id = el.id;
    }
    const testId = el.getAttribute('data-testid');
    if (testId) {
      desc.testId = testId;
    }
    const attrs = testAttrs(el);
    if (attrs !== undefined) {
      desc.testAttributes = attrs;
    }
    const role = el.getAttribute('role');
    if (role) {
      desc.role = role;
    }
    const acc = accessibleName(el);
    if (acc !== undefined) {
      desc.accessibleName = acc;
    }
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, TEXT_MAX);
    if (text.length > 0 && text.length < 200) {
      desc.text = text;
    }
    const name = el.getAttribute('name');
    if (name) {
      desc.name = name;
    }
    const css = uniqueCss(el);
    if (css !== undefined) {
      desc.cssSelector = css;
    }
    desc.xpath = xpathFor(el);
    const parent = el.parentElement;
    if (parent !== null) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
      desc.siblingIndex = siblings.indexOf(el);
    }
    const ancestors: string[] = [];
    let walk = el.parentElement;
    while (walk !== null && ancestors.length < 8) {
      ancestors.push(walk.tagName.toLowerCase());
      walk = walk.parentElement;
    }
    if (ancestors.length > 0) {
      desc.ancestors = ancestors;
    }
    const rect = el.getBoundingClientRect();
    desc.boundingBox = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    return desc;
  };

  const pageInfo = (): { url: string; title: string } => ({
    url: location.href,
    title: document.title
  });

  const fieldMeta = (el: Element): Record<string, string> => {
    const meta: Record<string, string> = {};
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.type) {
        meta.type = el.type;
      }
      const ac = el.getAttribute('autocomplete');
      if (ac) {
        meta.autocomplete = ac;
      }
      if (el.name) {
        meta.name = el.name;
      }
    }
    return meta;
  };

  const emitDom = (kind: string, el: Element, extra?: Record<string, unknown>): void => {
    const payload: Record<string, unknown> = {
      v: 1,
      kind,
      ts: Date.now(),
      page: pageInfo(),
      target: describe(el)
    };
    Object.assign(payload, extra ?? {});
    emit(payload);
  };

  const isCheckable = (el: Element): boolean =>
    el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');

  const isSelect = (el: Element): el is HTMLSelectElement => el instanceof HTMLSelectElement;

  const isTypedField = (el: Element): boolean => {
    if (el instanceof HTMLTextAreaElement) {
      return true;
    }
    if (!(el instanceof HTMLInputElement)) {
      return false;
    }
    return (
      el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button' && el.type !== 'submit'
    );
  };

  const flushInput = (el: EventTarget): void => {
    const timer = inputTimers.get(el);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      inputTimers.delete(el);
    }
    const latest = inputLatest.get(el);
    inputLatest.delete(el);
    if (latest !== undefined) {
      emit(latest);
    }
  };

  const noteInput = (el: Element): void => {
    if (
      !isTypedField(el) ||
      !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    const extra: Record<string, unknown> = {
      valueText: el.value,
      ...fieldMeta(el)
    };
    const payload: Record<string, unknown> = {
      v: 1,
      kind: 'dom.input',
      ts: Date.now(),
      page: pageInfo(),
      target: describe(el),
      ...extra
    };
    inputLatest.set(el, payload);
    const prev = inputTimers.get(el);
    if (prev !== undefined) {
      window.clearTimeout(prev);
    }
    const timer = window.setTimeout(() => {
      flushInput(el);
    }, config.inputAggregationMs);
    inputTimers.set(el, timer);
  };

  const onClick = (event: Event): void => {
    const el = composedElement(event);
    if (el === undefined) {
      return;
    }
    if (isCheckable(el) || isSelect(el)) {
      return;
    }
    emitDom(event.type === 'dblclick' ? 'dom.dblclick' : 'dom.click', el);
  };

  const onChange = (event: Event): void => {
    const el = composedElement(event);
    if (el === undefined) {
      return;
    }
    if (isTypedField(el)) {
      flushInput(el);
      return;
    }
    if (isCheckable(el)) {
      const input = el as HTMLInputElement;
      emitDom('dom.check', el, {
        checked: input.checked,
        valueText: input.value,
        ...fieldMeta(el)
      });
      return;
    }
    if (isSelect(el)) {
      emitDom('dom.select', el, { selectedValue: el.value, valueText: el.value, ...fieldMeta(el) });
      return;
    }
    emitDom('dom.change', el);
  };

  const onInput = (event: Event): void => {
    const el = composedElement(event);
    if (el === undefined) {
      return;
    }
    noteInput(el);
  };

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    const el = composedElement(event);
    if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') {
      if (el !== undefined && isTypedField(el)) {
        flushInput(el);
      }
      if (el !== undefined) {
        emitDom('dom.key', el, { key: event.key });
      }
    }
  };

  const onSubmit = (event: Event): void => {
    const el = composedElement(event);
    if (el !== undefined) {
      emitDom('dom.submit', el);
    }
  };

  const onScroll = (event: Event): void => {
    const el = composedElement(event) ?? document.documentElement;
    let delta = 0;
    if (event instanceof WheelEvent) {
      delta = event.deltaY;
    } else if (el instanceof Element) {
      delta = el.scrollTop;
    }
    scrollAccum += delta;
    if (Math.abs(scrollAccum) >= config.scrollThresholdPx) {
      const target = el instanceof Element ? el : document.documentElement;
      emitDom('dom.scroll', target, { scrollDelta: scrollAccum });
      scrollAccum = 0;
    }
  };

  const onBlur = (event: Event): void => {
    const el = composedElement(event);
    if (el !== undefined) {
      flushInput(el);
    }
  };

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  const emitSpa = (): void => {
    emit({
      v: 1,
      kind: 'nav.spa',
      ts: Date.now(),
      page: pageInfo()
    });
  };
  history.pushState = function pushStateSpy(...args: Parameters<History['pushState']>) {
    origPush(...args);
    emitSpa();
  };
  history.replaceState = function replaceStateSpy(...args: Parameters<History['replaceState']>) {
    origReplace(...args);
    emitSpa();
  };
  window.addEventListener('popstate', emitSpa, true);

  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('click', onClick, opts);
  window.addEventListener('dblclick', onClick, opts);
  window.addEventListener('input', onInput, opts);
  window.addEventListener('change', onChange, opts);
  window.addEventListener('keydown', onKeyDown, opts);
  window.addEventListener('submit', onSubmit, opts);
  window.addEventListener('scroll', onScroll, opts);
  window.addEventListener('wheel', onScroll, opts);
  window.addEventListener('focusout', onBlur, opts);
}
