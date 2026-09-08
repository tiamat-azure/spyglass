import type { Scenario } from '@spyglass/contracts';
import { launchPlaywrightRun, resolveReportDir } from './launch.ts';
import { parseGeneratedArgv } from './options.ts';
import { newRunId } from './run.ts';
import { asScenario } from './scenario.ts';

/**
 * Entry used by generated scenario.ts (Lot 6 / F-45 / F-58).
 * Visible unless --headless. --no-ai constructs no LLM client.
 */
export async function runGeneratedScript(
  scenarioInput: unknown,
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  scriptDir: string = process.cwd()
): Promise<number> {
  const parsed = parseGeneratedArgv(argv, env);
  if (parsed.help) {
    process.stdout.write(generatedHelpText());
    return 0;
  }
  const scenario: Scenario = asScenario(scenarioInput, parsed.baseUrl);
  const runId = newRunId();
  const reportDir = resolveReportDir(parsed.reportDir, scriptDir, runId);
  const proof = env.SPYGLASS_PROOF_SCREENSHOT;
  try {
    const result = await launchPlaywrightRun({
      scenario,
      parsed,
      env,
      reportDir,
      runId,
      ...(proof !== undefined && proof.length > 0 ? { proofScreenshot: proof } : {})
    });
    process.stdout.write(`${JSON.stringify({ exitCode: result.exitCode, runDir: reportDir })}\n`);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function generatedHelpText(): string {
  return `scenario.ts — Spyglass generated runner (visible by default)
  --headless
  --base-url <url>
  --timeout <ms>
  --max-ai-retries <n>
  --no-ai
  --ai
  --report <dir>
  --trace
`;
}
