import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Scenario } from '@spyglass/contracts';
import { isMultimodal } from '@spyglass/llm';
import { createCliGateway } from './cli-gateway.ts';
import type { ParsedRunnerArgv, RunScenarioResult } from './options.ts';
import { runPath, traceFileName } from './paths.ts';
import { createPlaywrightDriver } from './playwright-driver.ts';
import { LlmRecoverer } from './recover.ts';
import { newRunId, runScenario } from './run.ts';

export type LaunchPlaywrightRunInput = {
  scenario: Scenario;
  parsed: ParsedRunnerArgv;
  env?: NodeJS.ProcessEnv;
  reportDir: string;
  runId?: string;
  proofScreenshot?: string;
};

/**
 * Shared Playwright launch + runScenario path for `spyglass-run` and the
 * generated thin script (Lot 6). `--no-ai` / CI never constructs an LLM gateway.
 */
export async function launchPlaywrightRun(
  input: LaunchPlaywrightRunInput
): Promise<RunScenarioResult> {
  const env = input.env ?? process.env;
  const { parsed, scenario, reportDir } = input;
  const runId = input.runId ?? newRunId();
  await mkdir(reportDir, { recursive: true });
  if (parsed.aiRecovery && !isMultimodal(parsed.smartModel)) {
    process.stderr.write(
      'warn: smart model is not multimodal; recovery will use the text DOM only (F-61).\n'
    );
  }
  const driver = await createPlaywrightDriver({
    headless: parsed.headless,
    trace: parsed.trace,
    env,
    ...(parsed.trace ? { tracePath: runPath(reportDir, traceFileName()) } : {})
  });
  const gateway = parsed.aiRecovery ? createCliGateway(env) : undefined;
  const recoverer = gateway === undefined ? undefined : new LlmRecoverer(gateway);
  try {
    const result = await runScenario(scenario, {
      driver,
      headless: parsed.headless,
      timeoutMs: parsed.timeoutMs,
      maxAiRetries: parsed.maxAiRetries,
      aiRecovery: parsed.aiRecovery,
      reportDir,
      trace: parsed.trace,
      smartModel: parsed.smartModel,
      env,
      runId,
      closeDriver: false,
      ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
      ...(recoverer !== undefined ? { recoverer } : {})
    });
    if (input.proofScreenshot !== undefined && input.proofScreenshot.length > 0) {
      await mkdir(dirname(input.proofScreenshot), { recursive: true });
      await driver.screenshot(input.proofScreenshot).catch(() => undefined);
    }
    await driver.close();
    return result;
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Report output directory (A19a). Relative `--report` is resolved from `baseDir`
 * (scenario file directory for `spyglass-run` / generated `scriptDir`), not cwd.
 */
export function resolveReportDir(
  reportDir: string | undefined,
  baseDir: string,
  runId: string
): string {
  if (reportDir !== undefined && reportDir.length > 0) {
    return isAbsolute(reportDir) ? reportDir : resolve(baseDir, reportDir);
  }
  return runPath(baseDir, '..', 'runs', runId);
}
