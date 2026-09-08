import { mkdir, writeFile } from 'node:fs/promises';
import type { ExecutionReport, SuggestedPatch } from '@spyglass/contracts';
import { runPath } from './paths.ts';

export async function writeRunArtifacts(options: {
  runDir: string;
  report: ExecutionReport;
  suggestedPatch?: SuggestedPatch;
}): Promise<{ reportPath: string; patchPath?: string }> {
  await mkdir(options.runDir, { recursive: true });
  const reportPath = runPath(options.runDir, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(options.report, null, 2)}\n`, 'utf8');
  if (options.suggestedPatch === undefined || options.suggestedPatch.patches.length === 0) {
    return { reportPath };
  }
  const patchPath = runPath(options.runDir, 'suggested-patch.json');
  await writeFile(patchPath, `${JSON.stringify(options.suggestedPatch, null, 2)}\n`, 'utf8');
  return { reportPath, patchPath };
}
