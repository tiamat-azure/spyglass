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

  it('includes the observe script and shared guest matcher in the electron-builder payload', () => {
    const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('scripts/stagehand-observe.mjs');
    expect(yml).toContain('scripts/cdp-guest.mjs');
  });

  it('observe worker imports the shared guest matcher and fails closed on page match', () => {
    const observe = readFileSync(join(appRoot, 'scripts/stagehand-observe.mjs'), 'utf8');
    expect(observe).toContain("from './cdp-guest.mjs'");
    expect(observe).toContain('pageMatchesPickedGuest');
    expect(observe).toContain('pickGuestTarget');
    expect(observe).not.toContain('!isChromeUiUrl(url) && url.length > 0');
  });

  it('asarUnpacks Stagehand runtime node_modules for packaged Observe', () => {
    const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('node_modules/**');
    expect(yml).toMatch(/asarUnpack:/);
  });
});
