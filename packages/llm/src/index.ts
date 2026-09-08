export type { BatcherOptions } from './batch.ts';
export { SlidingBatcher } from './batch.ts';
export type {
  BudgetDecision,
  BudgetHalt,
  FastTokenBudgetOptions,
  UsageSnapshot
} from './budget.ts';
export { FastTokenBudget } from './budget.ts';
export type {
  ConnectionTestResult,
  LlmGatewayOptions,
  LlmProfileName,
  LlmTransport,
  MockTransportOptions,
  NarrateResult,
  ProfileConfig,
  RecoverTransportResult,
  RefineTransportResult,
  TransportRequest,
  TransportResult
} from './client.ts';
export {
  createMockTransport,
  fetchTransport,
  isMultimodal,
  LlmGateway,
  mockEnrichment,
  resolveProfile,
  toTransportRequest
} from './client.ts';
export {
  LLM_FAST_BATCH_MS_DEFAULT,
  LLM_FAST_MODEL_DEFAULT,
  LLM_FAST_PROVIDER_DEFAULT,
  LLM_FAST_TIMEOUT_MS_DEFAULT,
  LLM_SMART_MAX_TOKENS_DEFAULT,
  LLM_SMART_MODEL_ALIAS,
  LLM_SMART_MODEL_DEFAULT,
  LLM_SMART_PROVIDER_DEFAULT,
  LLM_SMART_TIMEOUT_MS_DEFAULT,
  MAX_AI_RETRIES_DEFAULT,
  pinSmartModel,
  RATE_LIMIT_CALLS_PER_MIN_DEFAULT,
  RECOVER_SYSTEM_PROMPT,
  REFINE_SYSTEM_PROMPT,
  SESSION_TOKEN_LIMIT_FAST_DEFAULT,
  SMART_TOKEN_CONFIRM_DEFAULT,
  TOKEN_WARN_RATIO_DEFAULT
} from './constants.ts';
export type { ExpurgatedEvent, ExpurgatedTarget } from './expurgate.ts';
export {
  assertNoLeak,
  expurgateBatch,
  expurgateEvent,
  expurgatePage,
  expurgateTarget,
  redactUrl,
  scrubText,
  secretLikeTokens,
  sensitiveQueryValues
} from './expurgate.ts';
export type { GabaritInput, GabaritTarget, GabaritValue, GabaritVoice } from './gabarits.ts';
export { elementLabel, gabaritText, isEnrichableKind, quotedLabel } from './gabarits.ts';
export { looksLikeCssSelector, normalizeHttpOrHttpsUrl, resolveReplayGotoUrl } from './http-url.ts';
export type { NarrationItem, NarrationResponse } from './narration.ts';
export {
  buildNarrationMessages,
  buildNarrationUserPayload,
  parseNarrationResponse
} from './narration.ts';
export type { ObserveCandidate } from './observe-match.ts';
export {
  applyCorrelatedObserveEnrichment,
  applyMatchedObservation,
  bestCorrelatedObservation,
  normalizeObserveSelector,
  observeMatchScore,
  stableObserveKeys
} from './observe-match.ts';
export { LLM_PACKAGE, llmPackageName } from './package-name.ts';
export type { RecoveryPatchProposal, RecoveryPromptInput } from './recover.ts';
export {
  assertRecoverPayloadClean,
  buildRecoverMessages,
  buildRecoverUserPayload,
  mockRecoverProposal,
  parseRecoverResponse,
  recoverForbiddenTokens
} from './recover.ts';
export type {
  ExpurgatedRefineEvent,
  LlmRefineProposal,
  RefineAggressiveness,
  WeakGroup
} from './refine.ts';
export {
  allowedRefineIds,
  bindLlmProposal,
  buildRefineMessages,
  buildRefineUserPayload,
  canFinalize,
  collectRetractedIds,
  estimateRefineTokens,
  expurgateForRefine,
  isReplayDescriptorSufficient,
  mockRefineProposals,
  parseRefineResponse,
  refineFromRaw,
  sourceEventsAreTraceable,
  unconfirmedWeaks,
  urlGlob,
  weakGroup
} from './refine.ts';
export type { SmartEstimate, SmartUsage } from './smart-budget.ts';
export { SmartOperationBudget } from './smart-budget.ts';
