import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { generatedHelpText, spyglassRunHelpText } from './help-text.ts';

describe('shared F-58 help text (H29a / L6-029)', () => {
  it('keeps spyglass-run and generated-script help identical to the pre-extract strings', () => {
    expect(spyglassRunHelpText()).toBe(`spyglass-run <scenario.json>
  --headless
  --base-url <url>
  --timeout <ms>
  --max-ai-retries <n>
  --no-ai
  --ai
  --report <dir>
  --trace

Relative --report is resolved from dirname(<scenario.json>), not process.cwd() (A19a).
Absolute --report is used as-is. Omit --report for ../runs/<runId>/ from that directory.
`);
    expect(generatedHelpText()).toBe(`scenario.ts — Spyglass generated runner (visible by default)
  --headless
  --base-url <url>
  --timeout <ms>
  --max-ai-retries <n>
  --no-ai
  --ai
  --report <dir>
  --trace

Relative --report is resolved from the scenario directory (this script's folder), not process.cwd() (A19a).
Absolute --report is used as-is. Omit --report for ../runs/<runId>/ from that directory.
`);
  });

  it('cli, generated-run, and run import help-text.ts instead of duplicating flags', async () => {
    const root = join(repoRoot(), 'packages/runner/src');
    const cli = await readFile(join(root, 'cli.ts'), 'utf8');
    const generated = await readFile(join(root, 'generated-run.ts'), 'utf8');
    const run = await readFile(join(root, 'run.ts'), 'utf8');
    expect(cli).toContain("from './help-text.ts'");
    expect(generated).toContain("from './help-text.ts'");
    expect(run).toContain("from './help-text.ts'");
    expect(cli).not.toContain('--max-ai-retries <n>');
    expect(generated).not.toContain('--max-ai-retries <n>');
    expect(run).not.toContain('--max-ai-retries <n>');
  });
});
