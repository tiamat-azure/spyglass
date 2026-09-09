import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { generatedHelpText, spyglassRunHelpText } from './help-text.ts';

describe('shared F-58 help text (H29a / L6-029)', () => {
  it('keeps the F-58 flag block identical and appends Lot 7 flags', () => {
    const f58 = `  --headless
  --base-url <url>
  --timeout <ms>
  --max-ai-retries <n>
  --no-ai
  --ai
  --report <dir>
  --trace`;
    expect(spyglassRunHelpText()).toContain(f58);
    expect(generatedHelpText()).toContain(f58);
    expect(spyglassRunHelpText()).toContain('--dataset <file>');
    expect(spyglassRunHelpText()).toContain('--repo <git-root>');
    expect(generatedHelpText()).toContain('--dataset <file>');
    expect(generatedHelpText()).toContain('PATCH_ASSISTED_APPLY');
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

  it('resolves --session-dir to an absolute path after parse (L7-104)', async () => {
    const cli = await readFile(join(repoRoot(), 'packages/runner/src/cli.ts'), 'utf8');
    expect(cli).toContain('parsed.sessionDir = resolve(parsed.sessionDir)');
  });
});
