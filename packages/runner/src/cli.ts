import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchPlaywrightRun, resolveReportDir } from './launch.ts';
import { parseRunnerArgv } from './options.ts';
import { newRunId } from './run.ts';
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
  const reportDir = resolveReportDir(parsed.reportDir, dirname(scenarioPath), runId);
  await mkdir(reportDir, { recursive: true });
  try {
    const result = await launchPlaywrightRun({
      scenario,
      parsed,
      env,
      reportDir,
      runId
    });
    process.stdout.write(`${JSON.stringify({ exitCode: result.exitCode, runDir: reportDir })}\n`);
    return result.exitCode;
  } catch (error) {
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
