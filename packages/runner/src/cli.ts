import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMultimodal } from '@spyglass/llm';
import { createCliGateway } from './cli-gateway.ts';
import { parseRunnerArgv } from './options.ts';
import { runPath, traceFileName } from './paths.ts';
import { createPlaywrightDriver } from './playwright-driver.ts';
import { LlmRecoverer } from './recover.ts';
import { newRunId, runScenario } from './run.ts';
import { loadScenarioFile } from './scenario.ts';

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const parsed = parseRunnerArgv(argv, env);
  if (parsed.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (parsed.scenarioPath === undefined) {
    process.stderr.write('Usage: spyglass-run <scenario.json> [options]\n');
    return 2;
  }
  const scenarioPath = resolve(parsed.scenarioPath);
  const scenario = await loadScenarioFile(scenarioPath, parsed.baseUrl);
  const runId = newRunId();
  const reportDir =
    parsed.reportDir !== undefined
      ? resolve(parsed.reportDir)
      : runPath(dirname(scenarioPath), '..', 'runs', runId);
  await mkdir(reportDir, { recursive: true });
  if (parsed.aiRecovery && !isMultimodal(parsed.smartModel)) {
    process.stderr.write(
      'warn: smart model is not multimodal; recovery will use the text DOM only (F-61).\n'
    );
  }
  const driver = await createPlaywrightDriver({
    headless: parsed.headless,
    trace: parsed.trace,
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
      closeDriver: true,
      ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
      ...(recoverer !== undefined ? { recoverer } : {})
    });
    process.stdout.write(`${JSON.stringify({ exitCode: result.exitCode, runDir: reportDir })}\n`);
    return result.exitCode;
  } catch (error) {
    await driver.close().catch(() => undefined);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function helpText(): string {
  return `spyglass-run <scenario.json>
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

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  void runCli().then((code) => {
    process.exit(code);
  });
}
