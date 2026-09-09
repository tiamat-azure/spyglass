import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Scenario } from '@spyglass/contracts';
import { isMultimodal } from '@spyglass/llm';
import { createCliGateway } from './cli-gateway.ts';
import type { ParsedRunnerArgv, RunScenarioResult } from './options.ts';
import { runPath, traceFileName } from './paths.ts';
import { createPlaywrightDriver } from './playwright-driver.ts';
import { LlmRecoverer, type Recoverer } from './recover.ts';
import { newRunId, type ReplayProgress, runScenario, type StepGate } from './run.ts';

export type LaunchPlaywrightRunInput = {
  scenario: Scenario;
  parsed: ParsedRunnerArgv;
  env?: NodeJS.ProcessEnv;
  reportDir: string;
  runId?: string;
  proofScreenshot?: string;
  /** L6-055: caller-supplied recoverer wins over createCliGateway(). */
  recoverer?: Recoverer;
  /** L6-073: forwarded into runScenario for driver-less callers. */
  onProgress?: (event: ReplayProgress) => void;
  stepGate?: StepGate;
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
  // L6-053: build recoverer before Chromium so a gateway throw cannot leak a browser.
  let recoverer = input.recoverer;
  if (recoverer === undefined && parsed.aiRecovery) {
    recoverer = new LlmRecoverer(createCliGateway(env));
  }
  const driver = await createPlaywrightDriver({
    headless: parsed.headless,
    trace: parsed.trace,
    env,
    ...(parsed.trace ? { tracePath: runPath(reportDir, traceFileName()) } : {})
  });
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
      ...(parsed.scenarioPath !== undefined ? { scenarioPath: parsed.scenarioPath } : {}),
      ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
      ...(parsed.repo !== undefined ? { repo: parsed.repo } : {}),
      ...(parsed.datasetPath !== undefined ? { datasetPath: parsed.datasetPath } : {}),
      ...(parsed.sessionDir !== undefined ? { sessionDir: parsed.sessionDir } : {}),
      ...(recoverer !== undefined ? { recoverer } : {}),
      ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
      ...(input.stepGate !== undefined ? { stepGate: input.stepGate } : {})
    });
    if (input.proofScreenshot !== undefined && input.proofScreenshot.length > 0) {
      await mkdir(dirname(input.proofScreenshot), { recursive: true });
      await driver.screenshot(input.proofScreenshot);
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
 * Absolute `--report` stays absolute after `resolve(reportDir)` (L6-076 Windows
 * drive-letter canonicalization).
 */
export function resolveReportDir(
  reportDir: string | undefined,
  baseDir: string,
  runId: string
): string {
  if (reportDir !== undefined && reportDir.length > 0) {
    return isAbsolute(reportDir) ? resolve(reportDir) : resolve(baseDir, reportDir);
  }
  return runPath(baseDir, '..', 'runs', runId);
}
