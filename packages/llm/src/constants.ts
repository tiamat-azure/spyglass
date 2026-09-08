/** I-03: dated Anthropic snapshot for the fast (narration) profile. */
export const LLM_FAST_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';

/** Default only — exact smart pin is I-05 (Lot 4). */
export const LLM_SMART_MODEL_DEFAULT = 'claude-sonnet-4-5-20250929';

export const LLM_FAST_PROVIDER_DEFAULT = 'anthropic';
export const LLM_SMART_PROVIDER_DEFAULT = 'anthropic';

export const LLM_FAST_BATCH_MS_DEFAULT = 500;
export const LLM_FAST_TIMEOUT_MS_DEFAULT = 1200;
export const SESSION_TOKEN_LIMIT_FAST_DEFAULT = 500_000;
export const TOKEN_WARN_RATIO_DEFAULT = 0.5;
export const RATE_LIMIT_CALLS_PER_MIN_DEFAULT = 60;
export const SMART_TOKEN_CONFIRM_DEFAULT = 100_000;

/** Visible label / text sent to a remote profile (6.9). */
export const EXPURGATE_TEXT_MAX = 80;

export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_MESSAGES_PATH = '/v1/messages';

export const DEFAULT_FAST_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const NARRATION_SYSTEM_PROMPT = [
  'Tu narrates des actions utilisateur en français.',
  'Une phrase par événement, à la deuxième personne, au passé composé, sans jargon technique.',
  "Jamais de valeur de champ, jamais d'URL complète, jamais de secret.",
  'Réponds uniquement par un JSON objet { "narrations": [ { "id": string, "text": string } ] }.',
  "Chaque id d'entrée doit apparaître une fois, aucun id inconnu."
].join(' ');
