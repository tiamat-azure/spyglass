const CARD_AUTOCOMPLETE = new Set([
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-family-name',
  'cc-name',
  'cc-type'
]);

const PASSWORD_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'password'
]);

export type MaskableField = {
  type?: string;
  autocomplete?: string;
  name?: string;
};

export type MaskDecision = { masked: false; text: string } | { masked: true; secretRef: string };

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function autocompleteTokens(field: MaskableField): string[] {
  const autocomplete = normalize(field.autocomplete);
  if (autocomplete.length === 0) {
    return [];
  }
  return autocomplete.split(/\s+/);
}

function isPasswordAutocomplete(field: MaskableField): boolean {
  for (const token of autocompleteTokens(field)) {
    if (PASSWORD_AUTOCOMPLETE.has(token)) {
      return true;
    }
  }
  return false;
}

function isCardAutocomplete(field: MaskableField): boolean {
  for (const token of autocompleteTokens(field)) {
    if (CARD_AUTOCOMPLETE.has(token) || token.startsWith('cc-')) {
      return true;
    }
  }
  return false;
}

function isPasswordName(field: MaskableField): boolean {
  const name = normalize(field.name);
  return name.includes('password') || name.includes('passwd');
}

export function secretRefFor(field: MaskableField): string {
  const type = normalize(field.type);
  if (type === 'password' || isPasswordAutocomplete(field) || isPasswordName(field)) {
    return 'SECRET_PASSWORD';
  }
  return 'SECRET_CARD';
}

export function shouldMaskField(field: MaskableField): boolean {
  const type = normalize(field.type);
  if (type === 'password') {
    return true;
  }
  if (isPasswordAutocomplete(field) || isCardAutocomplete(field)) {
    return true;
  }
  const name = normalize(field.name);
  if (
    name.includes('card') &&
    (name.includes('number') || name.includes('cvv') || name.includes('cvc'))
  ) {
    return true;
  }
  return isPasswordName(field);
}

export function maskCapturedValue(text: string, field: MaskableField): MaskDecision {
  if (!shouldMaskField(field)) {
    return { masked: false, text };
  }
  return { masked: true, secretRef: secretRefFor(field) };
}
