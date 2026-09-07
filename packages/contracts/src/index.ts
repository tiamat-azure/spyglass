export type { SchemaName } from './paths.ts';
export { examplesDir, repoRoot, schemaDir, schemaFiles } from './paths.ts';
export type {
  BoundingBox,
  CapturedValue,
  ElementDescriptor,
  RawEvent,
  RefinedStep,
  ReplayDescriptor,
  ScenarioHealth,
  VoiceCapture
} from './types.ts';
export {
  assertFixtureCorpus,
  createAjv,
  formatErrors,
  loadFixtureDir,
  runFixtureCorpus,
  schemaFromFixtureName,
  validateHealth,
  validateRawEvent,
  validateRefinedStep,
  validateUnknown
} from './validate.ts';
