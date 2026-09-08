/**
 * @spyglass/runner — deterministic replay + bounded AI recovery (Lot 5).
 * ADR-0006 / PRD F-50–F-61.
 */

export type { PageDriver, PageSnapshot } from './driver.ts';
export { MemoryPageDriver } from './memory-driver.ts';
export type {
  ParsedRunnerArgv,
  ResolveAiRecoveryInput,
  RunnerOptions,
  RunScenarioOptions,
  RunScenarioResult
} from './options.ts';
export {
  aiRecoveryEnabled,
  DEFAULT_STEP_TIMEOUT_MS,
  isCiEnv,
  MAX_AI_RETRIES_DEFAULT,
  parseRunnerArgv,
  resolveMaxAiRetries,
  resolveRunnerOptions,
  SMART_MODEL_PIN
} from './options.ts';
export { RUNNER_PACKAGE, runnerPackageName } from './package-name.ts';
export { runPath, screenshotFileName, traceFileName } from './paths.ts';
export { createPlaywrightDriver, PlaywrightPageDriver } from './playwright-driver.ts';
export type { Recoverer, RecoveryAttempt, RecoveryContext } from './recover.ts';
export { LlmRecoverer, OBSERVE_PREFER_MIN_SCORE, StaticRecoverer } from './recover.ts';
export { sanitizeRecoveredDescriptor } from './recover-sanitize.ts';
export { writeRunArtifacts } from './report.ts';
export type { ReplayProgress } from './run.ts';
export { newRunId, runScenario } from './run.ts';
export { asScenario, loadScenarioFile, scenarioFromRevision } from './scenario.ts';
export { verifyStep } from './verify.ts';
