export type GabaritTarget = {
  tag?: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  testId?: string;
  id?: string;
  name?: string;
};

export type GabaritValue = { masked: true; secretRef: string } | { masked: false; text: string };

export type GabaritInput = {
  kind: string;
  target?: GabaritTarget;
  value?: GabaritValue;
  page?: { url?: string; title?: string };
  key?: string;
};

const FALLBACK_LABEL = 'cet élément';

export function elementLabel(target: GabaritTarget | undefined): string {
  if (target === undefined) {
    return FALLBACK_LABEL;
  }
  const raw =
    nonempty(target.accessibleName) ??
    nonempty(target.text) ??
    nonempty(target.name) ??
    nonempty(target.testId) ??
    nonempty(target.id) ??
    nonempty(target.role) ??
    nonempty(target.tag);
  return raw ?? FALLBACK_LABEL;
}

export function quotedLabel(target: GabaritTarget | undefined): string {
  return `« ${elementLabel(target)} »`;
}

/**
 * Deterministic local narration (F-21, F-23, I-04).
 * Second person, passé composé, no field values, no URLs.
 */
export function gabaritText(input: GabaritInput): string {
  const q = quotedLabel(input.target);
  switch (input.kind) {
    case 'dom.click':
      return `Tu as cliqué sur ${q}`;
    case 'dom.dblclick':
      return `Tu as double-cliqué sur ${q}`;
    case 'dom.input':
      return `Tu as saisi du texte dans ${q}`;
    case 'dom.change':
      return `Tu as modifié ${q}`;
    case 'dom.check':
      return checkGabarit(input, q);
    case 'dom.select':
      return `Tu as choisi une option dans ${q}`;
    case 'dom.submit':
      return `Tu as soumis ${q}`;
    case 'dom.key':
      return keyGabarit(input, q);
    case 'dom.scroll':
      return 'Tu as fait défiler la page';
    case 'nav.load':
      return pageTitle(input) !== undefined
        ? `La page ${pageTitle(input) ?? ''} s'est chargée`
        : "La page s'est chargée";
    case 'nav.spa':
      return "Tu as navigué dans l'application";
    case 'nav.redirect':
      return 'La page a été redirigée';
    case 'nav.back':
      return 'Tu es revenu en arrière';
    case 'nav.forward':
      return 'Tu es allé en avant';
    case 'nav.popup-redirected':
      return 'Une fenêtre a été redirigée dans la page courante';
    case 'net.request':
      return 'Une requête réseau a suivi ton action';
    case 'selection.text':
      return 'Tu as sélectionné du texte';
    case 'selection.value':
      return `Tu as lu le contenu de ${q}`;
    case 'voice.partial':
      return 'Dictée en cours';
    case 'voice.final':
      return 'Un segment vocal a été transcrit';
    case 'voice.edited':
      return 'Un segment vocal a été corrigé';
    case 'agent.message':
      return "Message de l'agent";
    case 'agent.narration-mode':
      return 'Le mode de narration a changé';
    case 'user.message':
      return 'Message utilisateur';
    case 'record.start':
      return "L'enregistrement a commencé";
    case 'record.pause':
      return "L'enregistrement est en pause";
    case 'record.resume':
      return "L'enregistrement a repris";
    case 'record.stop':
      return "L'enregistrement s'est arrêté";
    case 'step.retracted':
      return 'Tu as rétracté une étape';
    default:
      return `Événement ${input.kind}`;
  }
}

export function isEnrichableKind(kind: string): boolean {
  return (
    kind.startsWith('dom.') ||
    kind.startsWith('nav.') ||
    kind.startsWith('selection.') ||
    kind === 'net.request'
  );
}

function checkGabarit(input: GabaritInput, quoted: string): string {
  if (input.value?.masked === false && input.value.text === 'false') {
    return `Tu as décoché ${quoted}`;
  }
  if (input.value?.masked === false && input.value.text === 'true') {
    return `Tu as coché ${quoted}`;
  }
  return `Tu as modifié la case ${quoted}`;
}

const NAMED_SAFE_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Esc',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Backspace',
  'Delete',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Insert',
  'Space'
]);

function keyGabarit(input: GabaritInput, quoted: string): string {
  if (input.value?.masked === true) {
    return `Tu as appuyé sur une touche dans ${quoted}`;
  }
  const key = nonempty(input.key);
  if (key === undefined || !isNamedSafeKey(key)) {
    return `Tu as appuyé sur une touche dans ${quoted}`;
  }
  return `Tu as appuyé sur ${key} dans ${quoted}`;
}

function isNamedSafeKey(key: string): boolean {
  return NAMED_SAFE_KEYS.has(key) || /^F([1-9]|1[0-2])$/.test(key);
}

function pageTitle(input: GabaritInput): string | undefined {
  const title = nonempty(input.page?.title);
  if (title === undefined) {
    return undefined;
  }
  return `« ${title} »`;
}

function nonempty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
