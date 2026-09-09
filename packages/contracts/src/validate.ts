import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { migrateHealthPatchCandidates } from './health-migrate.ts';
import { examplesDir, type SchemaName, schemaDir, schemaFiles } from './paths.ts';

export type ValidationResult = {
  valid: boolean;
  errors: ErrorObject[] | null;
  /** L7-241: `validateHealth` sets this to the migrated payload. */
  data?: unknown;
};

let cachedAjv: Ajv2020 | undefined;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function cloneSchema(schema: unknown): Record<string, unknown> {
  return structuredClone(schema) as Record<string, unknown>;
}

function cloneSchemaWithoutId(schema: unknown): Record<string, unknown> {
  const clone = cloneSchema(schema);
  delete clone.$id;
  return clone;
}

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true
  });
  addFormats(ajv);
  const dir = schemaDir();
  const raw = readJson(join(dir, schemaFiles['raw-event']));
  const refined = readJson(join(dir, schemaFiles['refined-step']));
  const health = readJson(join(dir, schemaFiles.health));
  const scenario = readJson(join(dir, schemaFiles.scenario));
  const executionReport = readJson(join(dir, schemaFiles['execution-report']));
  const suggestedPatch = readJson(join(dir, schemaFiles['suggested-patch']));
  // refined-step $ref's `raw-event.schema.json#/$defs/replayDescriptor`.
  // Ajv resolves that relative to the refined schema $id, so register aliases.
  ajv.addSchema(cloneSchema(raw));
  ajv.addSchema(cloneSchemaWithoutId(raw), schemaFiles['raw-event']);
  ajv.addSchema(cloneSchemaWithoutId(raw), 'https://spyglass.dev/schemas/raw-event.schema.json');
  ajv.addSchema(cloneSchema(refined), schemaFiles['refined-step']);
  ajv.addSchema(
    cloneSchemaWithoutId(refined),
    'https://spyglass.dev/schemas/refined-step.schema.json'
  );
  ajv.addSchema(cloneSchema(health), schemaFiles.health);
  ajv.addSchema(cloneSchema(scenario), schemaFiles.scenario);
  ajv.addSchema(cloneSchema(executionReport), schemaFiles['execution-report']);
  ajv.addSchema(cloneSchema(suggestedPatch), schemaFiles['suggested-patch']);
  return ajv;
}

export function getAjv(): Ajv2020 {
  cachedAjv ??= createAjv();
  return cachedAjv;
}

function compile(name: SchemaName): ValidateFunction {
  const file = schemaFiles[name];
  const existing = getAjv().getSchema(file);
  if (existing) {
    return existing;
  }
  throw new Error(`Schema not registered: ${file}`);
}

export function validateUnknown(name: SchemaName, data: unknown): ValidationResult {
  const validate = compile(name);
  const valid = validate(data) === true;
  return { valid, errors: valid ? null : (validate.errors ?? []) };
}

export function formatErrors(errors: ErrorObject[] | null): string {
  if (errors === null || errors.length === 0) {
    return '';
  }
  return errors
    .map((err) => {
      const path = err.instancePath.length > 0 ? err.instancePath : '/';
      return `${path} ${err.message ?? 'invalid'}`;
    })
    .join('; ');
}

export type FixtureKind = 'valid' | 'invalid';

export type FixtureCase = {
  kind: FixtureKind;
  schema: SchemaName;
  file: string;
  data: unknown;
};

const FILE_PREFIX: Array<{ prefix: string; schema: SchemaName }> = [
  { prefix: 'raw-event', schema: 'raw-event' },
  { prefix: 'refined-step', schema: 'refined-step' },
  { prefix: 'health', schema: 'health' },
  { prefix: 'scenario', schema: 'scenario' },
  { prefix: 'execution-report', schema: 'execution-report' },
  { prefix: 'suggested-patch', schema: 'suggested-patch' }
];

export function schemaFromFixtureName(fileName: string): SchemaName {
  const match = FILE_PREFIX.find((entry) => fileName.startsWith(`${entry.prefix}.`));
  if (match === undefined) {
    throw new Error(
      `Cannot infer schema from fixture name "${fileName}". Use raw-event.*, refined-step.*, health.*, scenario.*, execution-report.*, or suggested-patch.*`
    );
  }
  return match.schema;
}

export function loadFixtureDir(kind: FixtureKind): FixtureCase[] {
  const dir = join(examplesDir(), kind);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return files.map((name) => {
    const file = join(dir, name);
    return {
      kind,
      schema: schemaFromFixtureName(name),
      file,
      data: readJson(file)
    };
  });
}

export type CorpusReport = {
  acceptedValid: string[];
  rejectedValid: Array<{ file: string; errors: string }>;
  rejectedInvalid: string[];
  acceptedInvalid: string[];
};

export function runFixtureCorpus(): CorpusReport {
  const report: CorpusReport = {
    acceptedValid: [],
    rejectedValid: [],
    rejectedInvalid: [],
    acceptedInvalid: []
  };

  for (const fixture of loadFixtureDir('valid')) {
    const result = validateUnknown(fixture.schema, fixture.data);
    const label = basename(fixture.file);
    if (result.valid) {
      report.acceptedValid.push(label);
    } else {
      report.rejectedValid.push({ file: label, errors: formatErrors(result.errors) });
    }
  }

  for (const fixture of loadFixtureDir('invalid')) {
    const result = validateUnknown(fixture.schema, fixture.data);
    const label = basename(fixture.file);
    if (result.valid) {
      report.acceptedInvalid.push(label);
    } else {
      report.rejectedInvalid.push(label);
    }
  }

  return report;
}

export function assertFixtureCorpus(): CorpusReport {
  const report = runFixtureCorpus();
  if (report.rejectedValid.length > 0 || report.acceptedInvalid.length > 0) {
    const parts: string[] = [];
    for (const item of report.rejectedValid) {
      parts.push(`valid fixture rejected: ${item.file} (${item.errors})`);
    }
    for (const file of report.acceptedInvalid) {
      parts.push(`invalid fixture accepted: ${file}`);
    }
    throw new Error(parts.join('\n'));
  }
  return report;
}

export function validateRawEvent(data: unknown): ValidationResult {
  return validateUnknown('raw-event', data);
}

export function validateRefinedStep(data: unknown): ValidationResult {
  return validateUnknown('refined-step', data);
}

export function validateHealth(data: unknown): ValidationResult {
  // R28a: migrate missing runIds before schema checks (H21a load path).
  // L7-241: return the migrated payload so callers do not keep legacy-without-runIds after ok.
  const migrated = migrateHealthPatchCandidates(data);
  const result = validateUnknown('health', migrated);
  return { valid: result.valid, errors: result.errors, data: migrated };
}

export function validateScenario(data: unknown): ValidationResult {
  return validateUnknown('scenario', data);
}

export function validateExecutionReport(data: unknown): ValidationResult {
  return validateUnknown('execution-report', data);
}

export function validateSuggestedPatch(data: unknown): ValidationResult {
  return validateUnknown('suggested-patch', data);
}
