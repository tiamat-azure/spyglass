import { TEXT_MAX_LENGTH } from './constants.ts';

export type ReplaySelectorStrategy = 'testId' | 'role+name' | 'id' | 'text' | 'css' | 'xpath';

export type ReplayDescriptor = {
  type: 'click' | 'fill' | 'select' | 'check' | 'press' | 'navigate' | 'wait' | 'scroll';
  selector: string;
  selectorStrategy?: ReplaySelectorStrategy;
  description?: string;
  fallbackSelectors?: string[];
  arguments?: string[];
  framePath?: string[];
  shadowPath?: string[];
};

export type ProbeElementDescriptor = {
  tag: string;
  framePath: string[];
  shadowPath: string[];
  id?: string;
  testId?: string;
  testAttributes?: Record<string, string>;
  role?: string;
  accessibleName?: string;
  text?: string;
  name?: string;
  cssSelector?: string;
  xpath?: string;
  siblingIndex?: number;
  ancestors?: string[];
  boundingBox?: { x: number; y: number; w: number; h: number };
  /** Label `htmlFor` / associated control id (in-memory denoise only; stripped from jsonl). */
  htmlFor?: string;
};

export type ObserveCompatibleAction = {
  selector: string;
  description: string;
  method: string;
  arguments: string[];
};

export function cssEscapeIdent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

export function testIdSelector(testId: string): string {
  return `[data-testid="${cssEscapeIdent(testId)}"]`;
}

export function idSelector(id: string): string {
  if (/^[A-Za-z_][\w-]*$/.test(id)) {
    return `#${id}`;
  }
  return `[id="${cssEscapeIdent(id)}"]`;
}

export function pickSelectorStrategy(target: ProbeElementDescriptor): {
  selector: string;
  selectorStrategy: ReplaySelectorStrategy;
  fallbackSelectors: string[];
} {
  const fallbacks: string[] = [];
  const push = (value: string | undefined): void => {
    if (value !== undefined && value.length > 0 && !fallbacks.includes(value)) {
      fallbacks.push(value);
    }
  };

  if (target.testId !== undefined && target.testId.length > 0) {
    const selector = testIdSelector(target.testId);
    push(target.id !== undefined ? idSelector(target.id) : undefined);
    push(target.cssSelector);
    push(target.xpath !== undefined ? `xpath=${target.xpath}` : undefined);
    return { selector, selectorStrategy: 'testId', fallbackSelectors: fallbacks };
  }
  if (target.id !== undefined && target.id.length > 0) {
    const selector = idSelector(target.id);
    push(target.cssSelector);
    push(target.xpath !== undefined ? `xpath=${target.xpath}` : undefined);
    return { selector, selectorStrategy: 'id', fallbackSelectors: fallbacks };
  }
  if (
    target.role !== undefined &&
    target.role.length > 0 &&
    target.accessibleName !== undefined &&
    target.accessibleName.length > 0
  ) {
    const name = target.accessibleName.slice(0, TEXT_MAX_LENGTH);
    const selector = `role=${target.role}[name="${cssEscapeIdent(name)}"]`;
    push(target.cssSelector);
    push(target.xpath !== undefined ? `xpath=${target.xpath}` : undefined);
    return { selector, selectorStrategy: 'role+name', fallbackSelectors: fallbacks };
  }
  if (target.cssSelector !== undefined && target.cssSelector.length > 0) {
    push(target.xpath !== undefined ? `xpath=${target.xpath}` : undefined);
    return {
      selector: target.cssSelector,
      selectorStrategy: 'css',
      fallbackSelectors: fallbacks
    };
  }
  if (target.xpath !== undefined && target.xpath.length > 0) {
    return {
      selector: `xpath=${target.xpath}`,
      selectorStrategy: 'xpath',
      fallbackSelectors: fallbacks
    };
  }
  return {
    selector: target.tag,
    selectorStrategy: 'css',
    fallbackSelectors: fallbacks
  };
}

/**
 * Stagehand `act(Action)` resolves `>>` hops as iframe FrameLocators only.
 * Do not put open-shadow hosts in the hop chain — CSS pierce-fallback finds
 * `[data-testid]` / `#id` inside open shadow roots in the same frame.
 */
export function hopSelector(framePath: string[], inner: string): string {
  const hops = framePath.filter((part) => part !== 'main' && part.length > 0);
  if (hops.length === 0) {
    return inner;
  }
  return [...hops, inner].join(' >> ');
}

export function replayTypeForKind(kind: string): ReplayDescriptor['type'] | undefined {
  switch (kind) {
    case 'dom.click':
    case 'dom.dblclick':
    case 'dom.submit':
      return 'click';
    case 'dom.input':
    case 'dom.change':
      return 'fill';
    case 'dom.select':
      return 'select';
    case 'dom.check':
      return 'check';
    case 'dom.key':
      return 'press';
    case 'dom.scroll':
      return 'scroll';
    case 'nav.load':
    case 'nav.spa':
    case 'nav.redirect':
    case 'nav.back':
    case 'nav.forward':
      return 'navigate';
    default:
      return undefined;
  }
}

export function stagehandMethodFor(kind: string, type: ReplayDescriptor['type']): string {
  if (kind === 'dom.dblclick') {
    return 'doubleClick';
  }
  if (type === 'check') {
    return 'click';
  }
  if (type === 'select') {
    return 'selectOption';
  }
  if (type === 'scroll') {
    return 'scrollByPixelOffset';
  }
  if (type === 'fill') {
    return 'fill';
  }
  if (type === 'press') {
    return 'press';
  }
  if (type === 'click') {
    return 'click';
  }
  return type;
}

export function buildReplayDescriptor(options: {
  kind: string;
  target: ProbeElementDescriptor;
  description: string;
  args?: string[];
}): ReplayDescriptor | undefined {
  const type = replayTypeForKind(options.kind);
  if (type === undefined) {
    return undefined;
  }
  const picked = pickSelectorStrategy(options.target);
  const selector = hopSelector(options.target.framePath, picked.selector);
  const fallbackSelectors = picked.fallbackSelectors.map((item) =>
    hopSelector(options.target.framePath, item)
  );
  const descriptor: ReplayDescriptor = {
    type,
    selector,
    selectorStrategy: picked.selectorStrategy,
    description: options.description,
    framePath: options.target.framePath,
    shadowPath: options.target.shadowPath
  };
  if (fallbackSelectors.length > 0) {
    descriptor.fallbackSelectors = fallbackSelectors;
  }
  if (options.args !== undefined && options.args.length > 0) {
    descriptor.arguments = options.args;
  }
  return descriptor;
}

export function toObserveResult(action: ReplayDescriptor, kind: string): ObserveCompatibleAction {
  const method = stagehandMethodFor(kind, action.type);
  return {
    selector: action.selector,
    description: action.description ?? `${action.type} ${action.selector}`,
    method,
    arguments: action.arguments ?? []
  };
}

export function templateNarration(kind: string, target?: ProbeElementDescriptor): string {
  const label =
    target?.accessibleName ??
    target?.text ??
    target?.testId ??
    target?.id ??
    target?.tag ??
    'élément';
  switch (kind) {
    case 'dom.click':
      return `Clic sur « ${label} »`;
    case 'dom.dblclick':
      return `Double-clic sur « ${label} »`;
    case 'dom.input':
      return `Saisie dans « ${label} »`;
    case 'dom.change':
      return `Modification de « ${label} »`;
    case 'dom.check':
      return `Case « ${label} »`;
    case 'dom.select':
      return `Liste « ${label} »`;
    case 'dom.submit':
      return `Soumission « ${label} »`;
    case 'dom.key':
      return `Touche sur « ${label} »`;
    case 'dom.scroll':
      return 'Défilement';
    case 'nav.load':
      return 'Chargement de page';
    case 'nav.spa':
      return 'Navigation cliente';
    case 'nav.popup-redirected':
      return 'Popup redirigée dans la page courante';
    case 'record.start':
      return 'Enregistrement démarré';
    case 'record.stop':
      return 'Enregistrement arrêté';
    case 'step.retracted':
      return 'Étape rétractée';
    default:
      return kind;
  }
}
