import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('packaged Observe', () => {
  it('ships Stagehand and playwright-core as production dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@browserbasehq/stagehand']).toBe('3.7.3');
    expect(pkg.dependencies?.zod).toBe('3.25.76');
    expect(pkg.dependencies?.['playwright-core']).toBe('1.63.0');
    expect(pkg.devDependencies?.['@browserbasehq/stagehand']).toBeUndefined();
  });

  it('includes the observe script in the electron-builder payload', () => {
    const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('scripts/stagehand-observe.mjs');
  });
});
