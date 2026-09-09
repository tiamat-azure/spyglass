import type { Scenario } from '@spyglass/contracts';
import { generatedHelpText } from './help-text.ts';
import { parseGeneratedArgv } from './options.ts';
import { runScenario } from './run.ts';
import { asScenario } from './scenario.ts';

/**
 * Convenience wrapper around driver-less `runScenario` (prints exit JSON).
 * Omitting `driver` launches standalone Playwright Chromium (S44b) using
 * host `process.argv.slice(2)` / `process.env` (S66b).
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
  try {
    const scenario: Scenario = asScenario(scenarioInput);
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

export { generatedHelpText };
