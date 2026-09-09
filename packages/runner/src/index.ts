/**
 * @spyglass/runner — deterministic replay + bounded AI recovery + generated script (Lots 5–7).
 * ADR-0006 / ADR-0008 / PRD F-45, F-48, F-50–F-65, §6.12–6.13.
 */

export type { AssistedApplyResult, PreparePr } from './assisted-apply.ts';
export {
  ACTION_DESCRIPTOR_SCOPE,
  applyAssistedPatches,
  assertAssistedApplyAllowed,
  confirmedDescriptor
} from './assisted-apply.ts';
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
export { descriptorHash, patchSetHash } from './descriptor-hash.ts';
export type { PageDriver, PageSnapshot } from './driver.ts';
export type { GeneratedPackagePaths, WriteGeneratedPackageInput } from './generate.ts';
export {
  discardGeneratedPackage,
  GENERATED_DIR_NAME,
  GENERATED_GITIGNORE,
  GENERATED_PACKAGE_JSON,
  GENERATED_README,
  GENERATED_SCENARIO_JSON,
  GENERATED_SCENARIO_TS,
  generatedDir,
  generatedGitignore,
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
export type { GitExec, GitExecResult } from './git-repo.ts';
export {
  defaultGitExec,
  detectDefaultBranch,
  GitApplyError,
  isGitApplyError,
  isWorktreeDirty,
  patchBranchName
} from './git-repo.ts';
export type { PatchCandidate } from './health.ts';
export {
  emptyHealth,
  healthFilePath,
  healthStatus,
  incrementAppliedPatches,
  loadHealth,
  recordSuggestedPatches,
  resolveSessionDir,
  saveHealth
} from './health.ts';
export type { FixtureServer } from './http-fixture.ts';
/** F37a: public fixture server API (local corpus / Lot 6 capture). */
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
export type { ScenarioDataset } from './parameters.ts';
export {
  applyDataset,
  DATASETS_DIR,
  exampleDataset,
  extractScenarioParameters,
  parseDataset,
  writeGeneratedDatasets
} from './parameters.ts';
export type { PatchPolicy } from './patch-config.ts';
export {
  PATCH_CONFIRM_RUNS_DEFAULT,
  PATCH_STALE_THRESHOLD_DEFAULT,
  PATCH_WARN_THRESHOLD_DEFAULT,
  resolvePatchPolicy
} from './patch-config.ts';
export { processSuggestedPatch } from './patch-lifecycle.ts';
export {
  originalDescriptorForPatch,
  redactSuggestedPatchForPersistence
} from './patch-redact.ts';
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
export type { ReplayProgress, StepGate } from './run.ts';
export { newRunId, runScenario } from './run.ts';
export { asScenario, loadScenarioFile, scenarioFromRevision } from './scenario.ts';
export type { SessionExportOptions, SessionExportResult } from './session-bundle.ts';
export {
  exportSessionFolder,
  importSessionFolder,
  SESSION_BUNDLE_MANIFEST
} from './session-bundle.ts';
export { verifyStep } from './verify.ts';
