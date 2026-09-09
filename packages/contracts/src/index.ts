export { migrateHealthPatchCandidates } from './health-migrate.ts';
export type { SchemaName } from './paths.ts';
export { examplesDir, repoRoot, schemaDir, schemaFiles } from './paths.ts';
export type {
  BoundingBox,
  CapturedValue,
  ElementDescriptor,
  ExecutionReport,
  ExecutionStepMode,
  ExecutionStepReport,
  ExecutionStepStatus,
  RawEvent,
  RefinedStep,
  ReplayDescriptor,
  Scenario,
  ScenarioHealth,
  SuggestedPatch,
  SuggestedPatchEntry,
  VoiceCapture,
  VoiceRelation
} from './types.ts';
export {
  assertFixtureCorpus,
  createAjv,
  formatErrors,
  loadFixtureDir,
  runFixtureCorpus,
  schemaFromFixtureName,
  validateExecutionReport,
  validateHealth,
  validateRawEvent,
  validateRefinedStep,
  validateScenario,
  validateSuggestedPatch,
  validateUnknown
} from './validate.ts';
