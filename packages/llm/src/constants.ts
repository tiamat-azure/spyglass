/** I-03: dated Anthropic snapshot for the fast (narration) profile. */
export const LLM_FAST_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';

/**
 * I-05: dated Anthropic snapshot for the smart (refine / recover) profile.
 * Last YYYYMMDD Sonnet 4.x id, same pin style as Lot 2 Haiku. Alias
 * `claude-sonnet-4-5` is accepted. Residual: live bake-off not run here;
 * later `claude-sonnet-4-6` is a dateless-but-pinned 4.6 id, not adopted.
 */
export const LLM_SMART_MODEL_DEFAULT = 'claude-sonnet-4-5-20250929';
/** Undated Anthropic alias; `pinSmartModel` rewrites it to the dated I-05 snapshot. */
export const LLM_SMART_MODEL_ALIAS = 'claude-sonnet-4-5';

/** I-05: accept the undated 4.5 alias; leave any other id (including 4.6) untouched. */
export function pinSmartModel(model: string): string {
  return model === LLM_SMART_MODEL_ALIAS ? LLM_SMART_MODEL_DEFAULT : model;
}

export const LLM_FAST_PROVIDER_DEFAULT = 'anthropic';
export const LLM_SMART_PROVIDER_DEFAULT = 'anthropic';

export const LLM_FAST_BATCH_MS_DEFAULT = 500;
export const LLM_FAST_TIMEOUT_MS_DEFAULT = 1200;
/** Smart profile is latency-tolerant (ADR-0014); do not reuse the fast budget. */
export const LLM_SMART_TIMEOUT_MS_DEFAULT = 8000;
export const SESSION_TOKEN_LIMIT_FAST_DEFAULT = 500_000;
export const TOKEN_WARN_RATIO_DEFAULT = 0.5;
export const RATE_LIMIT_CALLS_PER_MIN_DEFAULT = 60;
export const SMART_TOKEN_CONFIRM_DEFAULT = 100_000;
/** Smart refine completions need more room than narration (ADR-0014). */
export const LLM_SMART_MAX_TOKENS_DEFAULT = 8192;
/** Bounded AI recovery attempts per step (F-53, MAX_AI_RETRIES). */
export const MAX_AI_RETRIES_DEFAULT = 3;

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

export const REFINE_SYSTEM_PROMPT = [
  'Tu raffines un enregistrement Spyglass en scénario structuré.',
  'Réponds uniquement par un JSON objet { "steps": [ ... ] }.',
  'Chaque étape: intent (français, première personne), actionType, sourceEvents (ids evt_ existants).',
  'Ne fournis pas verification.expected: type, expected et strength sont calculés localement.',
  'Ordre canonique: intention, action, vérification. Fusionne les répétitions, ignore le bruit et les étapes rétractées.',
  "Jamais de valeur de champ, jamais d'URL brute, jamais de secret, jamais d'id inconnu."
].join(' ');

export const RECOVER_SYSTEM_PROMPT = [
  "Tu diagnostiques l'échec d'une étape Spyglass et proposes un patch de descripteur d'action.",
  'Réponds uniquement par un JSON objet { "diagnosis": string, "patch": { "scope": "action.descriptor", "descriptor": { ... } }, "confidence": number }.',
  'scope ne peut valoir que action.descriptor. Ne propose jamais de modifier une vérification ni la structure du scénario.',
  "Jamais de valeur de champ, jamais d'URL brute, jamais de secret."
].join(' ');
