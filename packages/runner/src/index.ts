/**
 * @spyglass/runner — deterministic replay + bounded AI recovery + generated script (Lots 5–6).
 * ADR-0006 / PRD F-45, F-50–F-61, §6.12.
 */

export { applyBaseUrl } from './base-url.ts';
export type { CorpusSite, CorpusWaveResult, MeasuredRates } from './corpus.ts';
export {
  LOCAL_CORPUS_SIZE,
  localCorpusSites,
  measureCorpus,
  PUBLIC_CORPUS,
  publicSiteScenario,
  waitStep
} from './corpus.ts';
export type { PageDriver, PageSnapshot } from './driver.ts';
export type { GeneratedPackagePaths, WriteGeneratedPackageInput } from './generate.ts';
export {
  discardGeneratedPackage,
  GENERATED_DIR_NAME,
  GENERATED_PACKAGE_JSON,
  GENERATED_README,
  GENERATED_SCENARIO_JSON,
  GENERATED_SCENARIO_TS,
  generatedDir,
  generatedPackageManifest,
  generatedReadme,
  generatedScenarioJsonPath,
  generatedScenarioTsSource,
  generateFromSessionDir,
  loadFinalizedScenarioForGenerate,
  npmPackageNameForSession,
  readSessionStartUrl,
  writeGeneratedFromRevision,
  writeGeneratedPackage
} from './generate.ts';
export { generatedHelpText, runGeneratedScript } from './generated-run.ts';
export type { FixtureServer } from './http-fixture.ts';
export { startFixtureServer } from './http-fixture.ts';
export type { LaunchPlaywrightRunInput } from './launch.ts';
export { launchPlaywrightRun, resolveReportDir } from './launch.ts';
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
  parseGeneratedArgv,
  parseRunnerArgv,
  resolveMaxAiRetries,
  resolveRunnerOptions,
  SMART_MODEL_PIN
} from './options.ts';
export { RUNNER_PACKAGE, runnerPackageName } from './package-name.ts';
export { runPath, screenshotFileName, traceFileName } from './paths.ts';
export type { PlaywrightLaunchOptions } from './playwright-driver.ts';
export {
  chromiumLaunchArgs,
  createPlaywrightDriver,
  PlaywrightPageDriver
} from './playwright-driver.ts';
export type { Recoverer, RecoveryAttempt, RecoveryContext } from './recover.ts';
export { LlmRecoverer, OBSERVE_PREFER_MIN_SCORE, StaticRecoverer } from './recover.ts';
export { sanitizeRecoveredDescriptor } from './recover-sanitize.ts';
export { writeRunArtifacts } from './report.ts';
export type { ReplayProgress } from './run.ts';
export { newRunId, runScenario } from './run.ts';
export { asScenario, loadScenarioFile, scenarioFromRevision } from './scenario.ts';
export { verifyStep } from './verify.ts';
