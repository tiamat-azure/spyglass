import { mkdir, writeFile } from 'node:fs/promises';
import type { ExecutionReport, Scenario, SuggestedPatch } from '@spyglass/contracts';
import { redactSuggestedPatchForPersistence } from './patch-redact.ts';
import { runPath } from './paths.ts';

export async function writeRunArtifacts(options: {
  runDir: string;
  report: ExecutionReport;
  suggestedPatch?: SuggestedPatch;
  /** P13a: recorded scenario so parameterized fill/select args are stripped on disk. */
  scenario?: Scenario;
}): Promise<{ reportPath: string; patchPath?: string }> {
  await mkdir(options.runDir, { recursive: true });
  const reportPath = runPath(options.runDir, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(options.report, null, 2)}\n`, 'utf8');
  if (options.suggestedPatch === undefined || options.suggestedPatch.patches.length === 0) {
    return { reportPath };
  }
  const suggestedPatch = redactSuggestedPatchForPersistence(
    options.suggestedPatch,
    options.scenario
  );
  const patchPath = runPath(options.runDir, 'suggested-patch.json');
  await writeFile(patchPath, `${JSON.stringify(suggestedPatch, null, 2)}\n`, 'utf8');
  return { reportPath, patchPath };
}
