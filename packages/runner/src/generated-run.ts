import type { Scenario } from '@spyglass/contracts';
import { parseGeneratedArgv } from './options.ts';
import { runScenario } from './run.ts';
import { asScenario } from './scenario.ts';

/**
 * Convenience wrapper around driver-less `runScenario` (prints exit JSON).
 * Generated scenario.ts calls `runScenario` directly (ADR-0006 / PRD §6.12).
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
  try {
    const result = await runScenario(scenario, {
      headless: parsed.headless,
      argv,
      env,
      scriptDir
    });
    process.stdout.write(
      `${JSON.stringify({ exitCode: result.exitCode, runDir: result.runDir ?? '' })}\n`
    );
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

Relative --report is resolved from the scenario directory (this script's folder), not process.cwd() (A19a).
Absolute --report is used as-is. Omit --report for ../runs/<runId>/ from that directory.
`;
}
