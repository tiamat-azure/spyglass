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

export type MaskableField = {
  type?: string;
  autocomplete?: string;
  name?: string;
};

export type MaskDecision = { masked: false; text: string } | { masked: true; secretRef: string };

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function secretRefFor(field: MaskableField): string {
  const type = normalize(field.type);
  if (type === 'password') {
    return 'SECRET_PASSWORD';
  }
  const name = normalize(field.name);
  if (name.includes('password') || name.includes('passwd')) {
    return 'SECRET_PASSWORD';
  }
  return 'SECRET_CARD';
}

export function shouldMaskField(field: MaskableField): boolean {
  const type = normalize(field.type);
  if (type === 'password') {
    return true;
  }
  const autocomplete = normalize(field.autocomplete);
  if (autocomplete.length > 0) {
    const tokens = autocomplete.split(/\s+/);
    for (const token of tokens) {
      if (CARD_AUTOCOMPLETE.has(token) || token.startsWith('cc-')) {
        return true;
      }
    }
  }
  const name = normalize(field.name);
  if (
    name.includes('card') &&
    (name.includes('number') || name.includes('cvv') || name.includes('cvc'))
  ) {
    return true;
  }
  return false;
}

export function maskCapturedValue(text: string, field: MaskableField): MaskDecision {
  if (!shouldMaskField(field)) {
    return { masked: false, text };
  }
  return { masked: true, secretRef: secretRefFor(field) };
}
