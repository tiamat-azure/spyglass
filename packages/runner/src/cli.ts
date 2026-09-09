import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spyglassRunHelpText } from './help-text.ts';
import { launchPlaywrightRun, resolveReportDir } from './launch.ts';
import { parseRunnerArgv } from './options.ts';
import { newRunId } from './run.ts';
import { loadScenarioFile } from './scenario.ts';

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  let parsed: ReturnType<typeof parseRunnerArgv>;
  try {
    parsed = parseRunnerArgv(argv, env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(spyglassRunHelpText());
    return 0;
  }
  if (parsed.scenarioPath === undefined) {
    process.stderr.write('Usage: spyglass-run <scenario.json> [options]\n');
    return 2;
  }
  const scenarioPath = resolve(parsed.scenarioPath);
  parsed.scenarioPath = scenarioPath;
  if (parsed.repo !== undefined) {
    parsed.repo = resolve(parsed.repo);
  }
  if (parsed.datasetPath !== undefined && parsed.datasetPath.length > 0) {
    parsed.datasetPath = isAbsolute(parsed.datasetPath)
      ? parsed.datasetPath
      : resolve(dirname(scenarioPath), parsed.datasetPath);
  }
  try {
    const scenario = await loadScenarioFile(scenarioPath);
    const runId = newRunId();
    const reportDir = resolveReportDir(parsed.reportDir, dirname(scenarioPath), runId);
    await mkdir(reportDir, { recursive: true });
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

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  void runCli().then((code) => {
    process.exit(code);
  });
}
