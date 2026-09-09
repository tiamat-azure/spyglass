import { MAX_AI_RETRIES_DEFAULT as LLM_MAX, LLM_SMART_MODEL_DEFAULT } from '@spyglass/llm';

export const MAX_AI_RETRIES_DEFAULT = LLM_MAX;
export const DEFAULT_STEP_TIMEOUT_MS = 10_000;
export const SMART_MODEL_PIN = LLM_SMART_MODEL_DEFAULT;

export type RunnerOptions = {
  headless: boolean;
  baseUrl?: string;
  timeoutMs: number;
  maxAiRetries: number;
  aiRecovery: boolean;
  reportDir?: string;
  trace: boolean;
  scenarioPath?: string;
  smartModel: string;
};

export type RunScenarioOptions = {
  headless?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  maxAiRetries?: number;
  aiRecovery?: boolean;
  reportDir?: string;
  trace?: boolean;
  smartModel?: string;
  env?: NodeJS.ProcessEnv;
};

export type RunScenarioResult = {
  exitCode: number;
  report: import('@spyglass/contracts').ExecutionReport;
  suggestedPatch?: import('@spyglass/contracts').SuggestedPatch;
  runDir?: string;
};

export type ResolveAiRecoveryInput = {
  noAi?: boolean;
  forceAi?: boolean;
  env?: NodeJS.ProcessEnv;
};

export type ParsedRunnerArgv = RunnerOptions & {
  noAi: boolean;
  forceAi: boolean;
  help: boolean;
};

export function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CI;
  if (raw === undefined) {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * F-60: CI defaults to --no-ai. Explicit --ai forces recovery on.
 * --no-ai always wins over --ai.
 */
export function aiRecoveryEnabled(input: ResolveAiRecoveryInput = {}): boolean {
  if (input.noAi === true) {
    return false;
  }
  if (input.forceAi === true) {
    return true;
  }
  return !isCiEnv(input.env);
}

export function resolveMaxAiRetries(
  cliValue: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): number {
  if (cliValue !== undefined && Number.isInteger(cliValue) && cliValue >= 0) {
    return cliValue;
  }
  const raw = env.MAX_AI_RETRIES;
  if (raw !== undefined && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return MAX_AI_RETRIES_DEFAULT;
}

export function resolveRunnerOptions(
  partial: RunScenarioOptions = {},
  env: NodeJS.ProcessEnv = partial.env ?? process.env
): RunnerOptions {
  const timeoutMs =
    partial.timeoutMs !== undefined && partial.timeoutMs > 0
      ? partial.timeoutMs
      : DEFAULT_STEP_TIMEOUT_MS;
  const headless = partial.headless ?? isCiEnv(env);
  const options: RunnerOptions = {
    headless,
    timeoutMs,
    maxAiRetries: resolveMaxAiRetries(partial.maxAiRetries, env),
    aiRecovery: partial.aiRecovery ?? aiRecoveryEnabled({ env }),
    trace: partial.trace === true,
    smartModel: partial.smartModel ?? env.LLM_SMART_MODEL ?? SMART_MODEL_PIN
  };
  if (partial.baseUrl !== undefined && partial.baseUrl.length > 0) {
    options.baseUrl = partial.baseUrl;
  }
  if (partial.reportDir !== undefined && partial.reportDir.length > 0) {
    options.reportDir = partial.reportDir;
  }
  return options;
}

export function parseRunnerArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): ParsedRunnerArgv {
  let headless = isCiEnv(env);
  let baseUrl: string | undefined;
  let timeoutMs: number | undefined;
  let maxAiRetries: number | undefined;
  let noAi = false;
  let forceAi = false;
  let reportDir: string | undefined;
  let trace = false;
  let scenarioPath: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--headless') {
      headless = true;
      continue;
    }
    if (arg === '--no-ai') {
      noAi = true;
      continue;
    }
    if (arg === '--ai') {
      forceAi = true;
      continue;
    }
    if (arg === '--trace') {
      trace = true;
      continue;
    }
    const next = argv[index + 1];
    if (arg === '--base-url' && next !== undefined) {
      baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === '--timeout' && next !== undefined) {
      timeoutMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (arg === '--max-ai-retries' && next !== undefined) {
      maxAiRetries = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (arg === '--report' && next !== undefined) {
      reportDir = next;
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) {
      scenarioPath = arg;
    }
  }

  const resolved = resolveRunnerOptions(
    {
      headless,
      aiRecovery: aiRecoveryEnabled({ noAi, forceAi, env }),
      trace,
      env,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxAiRetries !== undefined ? { maxAiRetries } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(reportDir !== undefined ? { reportDir } : {})
    },
    env
  );
  const parsed: ParsedRunnerArgv = {
    ...resolved,
    noAi,
    forceAi,
    help
  };
  if (scenarioPath !== undefined) {
    parsed.scenarioPath = scenarioPath;
  }
  return parsed;
}

/**
 * F-45: generated scripts are headed (visible) unless `--headless` is present.
 * CI still disables AI recovery (F-60) via `aiRecoveryEnabled`.
 * D35b: `createPlaywrightDriver` also stays headed unless `headless === true`.
 */
export function parseGeneratedArgv(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): ParsedRunnerArgv {
  const parsed = parseRunnerArgv(argv, env);
  parsed.headless = argv.includes('--headless');
  return parsed;
}
