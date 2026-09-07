import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function repoRoot(): string {
  let dir = here;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(join(dir, 'docs/contracts'))) {
      return dir;
    }
    dir = join(dir, '..');
  }
  throw new Error('Unable to resolve Spyglass repository root from contracts package');
}

export function schemaDir(): string {
  return join(repoRoot(), 'docs/contracts/schemas');
}

export function examplesDir(): string {
  return join(repoRoot(), 'docs/contracts/examples');
}

export const schemaFiles = {
  'raw-event': 'raw-event.schema.json',
  'refined-step': 'refined-step.schema.json',
  health: 'health.schema.json'
} as const;

export type SchemaName = keyof typeof schemaFiles;
