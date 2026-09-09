import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type {
  ExecutionReport,
  ExecutionStepReport,
  RefinedStep,
  ReplayDescriptor,
  Scenario,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { isMultimodal, pinSmartModel } from '@spyglass/llm';
import { performAction } from './act.ts';
import type { PreparePr } from './assisted-apply.ts';
import { applyBaseUrl } from './base-url.ts';
import type { PageDriver } from './driver.ts';
import type { GitExec } from './git-repo.ts';
import { generatedHelpText } from './help-text.ts';
import {
  parseGeneratedArgv,
  type RunScenarioOptions,
  type RunScenarioResult,
  resolveRunnerOptions,
  SMART_MODEL_PIN
} from './options.ts';
import { applyDataset, parseDataset } from './parameters.ts';
import { resolvePatchPolicy } from './patch-config.ts';
import { processSuggestedPatch } from './patch-lifecycle.ts';
import {
  findStepByIndex,
  hasParameterRef,
  originalDescriptorForPatch,
  overlayLiveArgumentsForRecovery,
  redactSuggestedPatchEntryForPersistence,
  redactSuggestedPatchForPersistence
} from './patch-redact.ts';
import { runPath, screenshotFileName } from './paths.ts';
import type { Recoverer, RecoveryAttempt } from './recover.ts';
import { sanitizeRecoveredDescriptor } from './recover-sanitize.ts';
import { writeRunArtifacts } from './report.ts';
import { cloneDescriptor } from './scenario.ts';
import { verifyStep } from './verify.ts';

export type ReplayProgress = {
  runId: string;
  stepIndex: number;
  status: 'running' | 'passed' | 'failed' | 'recovering';
  mode: 'script' | 'AI';
  attempt: number;
  message: string;
};

/** F-59: wait before each step for in-app pas-à-pas replay. */
export type StepGate = {
  wait: (stepIndex: number) => Promise<'continue' | 'stop'>;
};

export type RunScenarioHooks = RunScenarioOptions & {
  /**
   * S44b / S66b: omit to launch a real standalone Playwright Chromium
   * (generated `scenario.ts` / CLI / ADR-0006) using host
   * `process.argv.slice(2)` and `process.env`. In-app callers (Electron
   * ReplayEngine) must pass an explicit driver bound to the guest window.
   */
  driver?: PageDriver;
  recoverer?: Recoverer;
  onProgress?: (event: ReplayProgress) => void;
  runId?: string;
  closeDriver?: boolean;
  /** F-58 flags for the driver-less generated-script path. */
  argv?: readonly string[];
  scriptDir?: string;
  stepGate?: StepGate;
  git?: GitExec;
  preparePr?: PreparePr;
};

const TEXT_ONLY_WARNING =
  'Smart model is not multimodal; recovery will use the text DOM only (F-61).';

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replaceAll(/[-:]/g, '').replace('T', '').slice(0, 14);
  return `run_${stamp}_${randomBytes(3).toString('hex')}`;
}

/**
 * Replay a scenario.
 *
 * S44b — omitting `options.driver` launches a real standalone Playwright
 * Chromium (`runScenarioStandalone` → `launchPlaywrightRun`). That is the
 * generated-script / CLI path. In-app replay must pass an explicit
 * `PageDriver` so Electron does not spawn a second browser.
 *
 * S66b — the driver-less path defaults `argv` to `process.argv.slice(2)` and
 * `env` to `process.env` (host process). Keep those defaults. In-app callers
 * pass an explicit driver and should not rely on host argv/env.
 */
export async function runScenario(
  scenario: Scenario,
  options: RunScenarioHooks = {}
): Promise<RunScenarioResult> {
  if (options.driver === undefined) {
    return await runScenarioStandalone(scenario, options);
  }
  return await runScenarioOnDriver(scenario, { ...options, driver: options.driver });
}

async function runScenarioStandalone(
  scenario: Scenario,
  options: RunScenarioHooks
): Promise<RunScenarioResult> {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const parsed = parseGeneratedArgv(argv, env);
  if (options.headless !== undefined) {
    parsed.headless = options.headless;
  }
  if (options.timeoutMs !== undefined) {
    parsed.timeoutMs = options.timeoutMs;
  }
  if (options.maxAiRetries !== undefined) {
    parsed.maxAiRetries = options.maxAiRetries;
  }
  if (options.aiRecovery !== undefined) {
    parsed.aiRecovery = options.aiRecovery;
  }
  if (options.trace !== undefined) {
    parsed.trace = options.trace;
  }
  if (options.smartModel !== undefined) {
    parsed.smartModel = options.smartModel;
  }
  if (options.baseUrl !== undefined) {
    parsed.baseUrl = options.baseUrl;
  }
  if (options.reportDir !== undefined) {
    parsed.reportDir = options.reportDir;
  }
  if (options.repo !== undefined) {
    parsed.repo = options.repo;
  }
  if (options.datasetPath !== undefined) {
    parsed.datasetPath = options.datasetPath;
  }
  if (options.sessionDir !== undefined) {
    parsed.sessionDir = options.sessionDir;
  }
  if (options.scenarioPath !== undefined) {
    parsed.scenarioPath = options.scenarioPath;
  }
  if (parsed.help) {
    process.stdout.write(generatedHelpText());
    const runId = options.runId ?? newRunId();
    return {
      exitCode: 0,
      report: {
        schemaVersion: 1,
        runId,
        sessionId: scenario.sessionId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        headless: false,
        aiRecovery: false,
        maxAiRetries: parsed.maxAiRetries,
        smartModel: SMART_MODEL_PIN,
        multimodal: true,
        warnings: [],
        steps: []
      }
    };
  }
  const { launchPlaywrightRun, resolveReportDir } = await import('./launch.ts');
  const runId = options.runId ?? newRunId();
  const scriptDir = options.scriptDir ?? process.cwd();
  const reportDir = resolveReportDir(parsed.reportDir, scriptDir, runId);
  const proof = env.SPYGLASS_PROOF_SCREENSHOT;
  return await launchPlaywrightRun({
    scenario,
    parsed,
    env,
    reportDir,
    runId,
    ...(proof !== undefined && proof.length > 0 ? { proofScreenshot: proof } : {}),
    ...(options.recoverer !== undefined ? { recoverer: options.recoverer } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.stepGate !== undefined ? { stepGate: options.stepGate } : {}),
    scriptDir
  });
}

async function runScenarioOnDriver(
  scenario: Scenario,
  options: RunScenarioHooks & { driver: PageDriver }
): Promise<RunScenarioResult> {
  const resolved = resolveRunnerOptions(options, options.env);
  const smartModel = pinSmartModel(resolved.smartModel);
  const multimodal = isMultimodal(smartModel);
  const warnings: string[] = [];
  if (resolved.aiRecovery && !multimodal) {
    warnings.push(TEXT_ONLY_WARNING);
  }
  const runId = options.runId ?? newRunId();
  const startedAt = new Date();
  let executable: Scenario;
  try {
    executable = await scenarioWithDataset(scenario, resolved, options);
  } catch (error) {
    return await datasetLoadFailure({
      scenario,
      resolved,
      options,
      error,
      runId,
      startedAt,
      smartModel,
      multimodal,
      warnings
    });
  }
  const original = scenario.steps.map((step) => originalDescriptorForPatch(step));
  const stepReports: ExecutionStepReport[] = [];
  const patches: SuggestedPatchEntry[] = [];
  let failed = false;

  const startUrl = joinBaseUrl(resolved.baseUrl, executable.startUrl);
  await options.driver.goto(startUrl);

  for (let index = 0; index < executable.steps.length; index += 1) {
    const step = executable.steps[index];
    if (step === undefined) {
      continue;
    }
    if (failed) {
      stepReports.push(skippedReport(step));
      continue;
    }
    const stepStarted = Date.now();
    emit(options, {
      runId,
      stepIndex: step.index,
      status: 'running',
      mode: 'script',
      attempt: 1,
      message: `script · ${step.intent}`
    });
    if (options.stepGate !== undefined) {
      const gate = await options.stepGate.wait(step.index);
      if (gate === 'stop') {
        failed = true;
        stepReports.push({
          index: step.index,
          intent: step.intent,
          status: 'failed',
          durationMs: Date.now() - stepStarted,
          mode: 'script',
          attempts: 1,
          verificationOk: false,
          error: 'replay stopped by user'
        });
        emit(options, {
          runId,
          stepIndex: step.index,
          status: 'failed',
          mode: 'script',
          attempt: 1,
          message: 'replay stopped by user'
        });
        for (let rest = index + 1; rest < executable.steps.length; rest += 1) {
          const skipped = executable.steps[rest];
          if (skipped !== undefined) {
            stepReports.push(skippedReport(skipped));
          }
        }
        break;
      }
    }
    const timeoutMs = step.verification.timeoutMs ?? resolved.timeoutMs;
    const beforeDom = await options.driver.snapshot();
    const acted = await performAction(options.driver, step.action.descriptor);
    let verify = acted.ok
      ? await verifyStep(options.driver, step, timeoutMs)
      : { ok: false as const, error: acted.error };
    let mode: 'script' | 'AI' = 'script';
    let attempts = 1;
    let error: string | undefined = verify.ok ? undefined : verify.error;
    let screenshotRef: string | undefined;
    const skipSecretShots = skipParameterizedScreenshots(executable, step);

    if (!verify.ok) {
      if (!skipSecretShots) {
        screenshotRef = await captureFailure(
          options.driver,
          resolved.reportDir,
          step.index,
          'fail'
        );
      }
      if (!resolved.aiRecovery || options.recoverer === undefined) {
        failed = true;
        const report = failedStepReport({
          step,
          durationMs: Date.now() - stepStarted,
          mode,
          attempts,
          error: error ?? 'verification failed',
          ...(screenshotRef !== undefined ? { screenshotRef } : {})
        });
        stepReports.push(report);
        emit(options, {
          runId,
          stepIndex: step.index,
          status: 'failed',
          mode,
          attempt: attempts,
          message: report.error ?? 'failed'
        });
        continue;
      }
      if (!multimodal) {
        warnings.push(TEXT_ONLY_WARNING);
      }
      const recovered = await recoverStep({
        scenario: scenarioForRecovery(scenario),
        argumentScenario: executable,
        step: stepForRecovery(scenario.steps[index] ?? step),
        driver: options.driver,
        recoverer: options.recoverer,
        timeoutMs,
        maxAiRetries: Math.max(1, resolved.maxAiRetries),
        multimodal,
        beforeDom,
        originalError: error ?? 'verification failed',
        runId,
        skipScreenshots: skipSecretShots,
        ...(resolved.reportDir !== undefined ? { reportDir: resolved.reportDir } : {}),
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {})
      });
      attempts = recovered.attempts;
      mode = 'AI';
      if (recovered.ok) {
        verify = { ok: true };
        error = undefined;
        patches.push(
          redactSuggestedPatchEntryForPersistence(
            {
              stepIndex: step.index,
              scope: 'action.descriptor',
              original: original[index] ?? cloneDescriptor(step.action.descriptor),
              suggested: recovered.descriptor,
              diagnosis: recovered.diagnosis,
              confidence: recovered.confidence
            },
            scenario.steps[index] ?? findStepByIndex(scenario, step.index)
          )
        );
        emit(options, {
          runId,
          stepIndex: step.index,
          status: 'passed',
          mode: 'AI',
          attempt: attempts,
          message: `AI recovery · ${step.intent}`
        });
      } else {
        failed = true;
        error = recovered.error;
        screenshotRef =
          recovered.screenshotRef ??
          (skipSecretShots
            ? undefined
            : await captureFailure(options.driver, resolved.reportDir, step.index, 'recover'));
        emit(options, {
          runId,
          stepIndex: step.index,
          status: 'failed',
          mode: 'AI',
          attempt: attempts,
          message: error
        });
      }
    } else {
      emit(options, {
        runId,
        stepIndex: step.index,
        status: 'passed',
        mode: 'script',
        attempt: 1,
        message: `script · ${step.intent}`
      });
    }

    const stepReport: ExecutionStepReport = {
      index: step.index,
      intent: step.intent,
      status: verify.ok ? 'passed' : 'failed',
      durationMs: Date.now() - stepStarted,
      mode,
      attempts,
      verificationOk: verify.ok
    };
    if (error !== undefined) {
      stepReport.error = error;
    }
    if (screenshotRef !== undefined) {
      stepReport.screenshotRef = screenshotRef;
    }
    stepReports.push(stepReport);
  }

  const finishedAt = new Date();
  const report: ExecutionReport = {
    schemaVersion: 1,
    runId,
    sessionId: executable.sessionId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    exitCode: failed ? 1 : 0,
    headless: resolved.headless,
    aiRecovery: resolved.aiRecovery,
    maxAiRetries: resolved.maxAiRetries,
    smartModel,
    multimodal,
    warnings: unique(warnings),
    steps: stepReports
  };
  const suggestedPatch: SuggestedPatch | undefined =
    patches.length > 0
      ? redactSuggestedPatchForPersistence(
          {
            schemaVersion: 1,
            runId,
            sessionId: executable.sessionId,
            applied: false,
            patches
          },
          scenario
        )
      : undefined;

  let runDir: string | undefined;
  if (resolved.reportDir !== undefined) {
    runDir = resolved.reportDir;
    await writeRunArtifacts({
      runDir,
      report,
      scenario,
      ...(suggestedPatch !== undefined ? { suggestedPatch } : {})
    });
  }

  if (options.closeDriver === true) {
    await options.driver.close();
  }

  const result: RunScenarioResult = { exitCode: report.exitCode, report };
  const suggested: SuggestedPatch = redactSuggestedPatchForPersistence(
    {
      schemaVersion: 1,
      runId,
      sessionId: executable.sessionId,
      applied: false,
      patches
    },
    scenario
  );
  if (suggestedPatch !== undefined) {
    result.suggestedPatch = suggestedPatch;
  }
  const lifecycleInput: Parameters<typeof processSuggestedPatch>[0] = {
    suggested,
    // L7-019: persist the recorded scenario, not dataset-materialized secrets.
    scenario,
    policy: resolvePatchPolicy(options.env ?? process.env, {
      ...(resolved.repo !== undefined ? { repo: resolved.repo } : {})
    })
  };
  if (options.env !== undefined) {
    lifecycleInput.env = options.env;
  }
  if (resolved.reportDir !== undefined) {
    lifecycleInput.reportDir = resolved.reportDir;
  }
  const scenarioPath = resolved.scenarioPath ?? options.scenarioPath;
  if (scenarioPath !== undefined) {
    lifecycleInput.scenarioPath = scenarioPath;
  }
  const sessionDir = resolved.sessionDir ?? options.sessionDir;
  if (sessionDir !== undefined) {
    lifecycleInput.sessionDir = sessionDir;
  }
  if (options.git !== undefined) {
    lifecycleInput.git = options.git;
  }
  if (options.preparePr !== undefined) {
    lifecycleInput.preparePr = options.preparePr;
  }
  const lifecycle = await processSuggestedPatch(lifecycleInput);
  if (lifecycle.healthPath !== undefined) {
    result.healthPath = lifecycle.healthPath;
  }
  if (lifecycle.assistedApply !== undefined) {
    result.assistedApply = lifecycle.assistedApply;
  }
  if (runDir !== undefined) {
    result.runDir = runDir;
  }
  return result;
}

async function recoverStep(input: {
  scenario: Scenario;
  /** L7-085: un-stripped scenario (dataset args / remaining recorded args) for text redaction. */
  argumentScenario?: Scenario;
  step: RefinedStep;
  driver: PageDriver;
  recoverer: Recoverer;
  timeoutMs: number;
  maxAiRetries: number;
  multimodal: boolean;
  beforeDom: Awaited<ReturnType<PageDriver['snapshot']>>;
  reportDir?: string;
  originalError: string;
  onProgress?: (event: ReplayProgress) => void;
  runId: string;
  /** S11a: skip screenshot files when parameterized secrets may be on screen. */
  skipScreenshots?: boolean;
}): Promise<
  | {
      ok: true;
      descriptor: ReplayDescriptor;
      diagnosis: string;
      confidence: number;
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; screenshotRef?: string }
> {
  let lastError = input.originalError;
  let screenshotRef: string | undefined;
  for (let attempt = 1; attempt <= input.maxAiRetries; attempt += 1) {
    const textOnly = input.multimodal
      ? ''
      : ' · smart model is not multimodal; text DOM only (F-61)';
    emit(input.onProgress === undefined ? {} : { onProgress: input.onProgress }, {
      runId: input.runId,
      stepIndex: input.step.index,
      status: 'recovering',
      mode: 'AI',
      attempt,
      message: `AI recovery attempt ${String(attempt)}/${String(input.maxAiRetries)}${textOnly}`
    });
    const afterDom = await input.driver.snapshot();
    screenshotRef = input.skipScreenshots
      ? undefined
      : await captureFailure(input.driver, input.reportDir, input.step.index, 'recover');
    const redactFrom = input.argumentScenario ?? input.scenario;
    const context = {
      scenario: input.scenario,
      step: input.step,
      attempt,
      error: lastError,
      beforeDom: redactSnapshotForRecovery(input.beforeDom, redactFrom),
      afterDom: redactSnapshotForRecovery(afterDom, redactFrom),
      multimodal: input.multimodal,
      ...(screenshotRef !== undefined ? { screenshotPath: screenshotRef } : {})
    };
    const recovered: RecoveryAttempt | undefined = await input.recoverer.recover(context);
    if (recovered === undefined) {
      lastError = `recovery produced no patch (attempt ${String(attempt)})`;
      continue;
    }
    const liveStep = findStepByIndex(input.argumentScenario, input.step.index);
    const descriptor = sanitizeRecoveredDescriptor(
      overlayLiveArgumentsForRecovery(input.step.action.descriptor, liveStep),
      recovered.descriptor
    );
    const acted = await performAction(input.driver, descriptor);
    if (!acted.ok) {
      lastError = acted.error;
      continue;
    }
    const verify = await verifyStep(input.driver, input.step, input.timeoutMs);
    if (verify.ok) {
      return {
        ok: true,
        descriptor,
        diagnosis: recovered.diagnosis,
        confidence: recovered.confidence,
        attempts: attempt + 1
      };
    }
    lastError = verify.error;
  }
  const exhausted: {
    ok: false;
    error: string;
    attempts: number;
    screenshotRef?: string;
  } = {
    ok: false,
    error: `AI recovery exhausted after ${String(input.maxAiRetries)} attempts: ${lastError}`,
    attempts: input.maxAiRetries + 1
  };
  if (screenshotRef !== undefined) {
    exhausted.screenshotRef = screenshotRef;
  }
  return exhausted;
}

function emit(
  options: { onProgress?: (event: ReplayProgress) => void },
  event: ReplayProgress
): void {
  options.onProgress?.(event);
}

function skippedReport(step: RefinedStep): ExecutionStepReport {
  return {
    index: step.index,
    intent: step.intent,
    status: 'skipped',
    durationMs: 0,
    mode: 'script',
    attempts: 1,
    verificationOk: false,
    error: 'skipped after previous failure'
  };
}

function failedStepReport(input: {
  step: RefinedStep;
  durationMs: number;
  mode: 'script' | 'AI';
  attempts: number;
  error: string;
  screenshotRef?: string;
}): ExecutionStepReport {
  const report: ExecutionStepReport = {
    index: input.step.index,
    intent: input.step.intent,
    status: 'failed',
    durationMs: input.durationMs,
    mode: input.mode,
    attempts: input.attempts,
    verificationOk: false,
    error: input.error
  };
  if (input.screenshotRef !== undefined) {
    report.screenshotRef = input.screenshotRef;
  }
  return report;
}

async function captureFailure(
  driver: PageDriver,
  reportDir: string | undefined,
  stepIndex: number,
  kind: 'fail' | 'recover'
): Promise<string | undefined> {
  if (reportDir === undefined) {
    const phantom = screenshotFileName(stepIndex, kind);
    await driver.screenshot(phantom).catch(() => undefined);
    return phantom;
  }
  const shots = runPath(reportDir, 'screenshots');
  await mkdir(shots, { recursive: true });
  const filePath = runPath(shots, screenshotFileName(stepIndex, kind));
  try {
    await driver.screenshot(filePath);
    return filePath;
  } catch {
    await writeFile(filePath, '', 'utf8').catch(() => undefined);
    return filePath;
  }
}

function joinBaseUrl(baseUrl: string | undefined, startUrl: string): string {
  return applyBaseUrl(baseUrl, startUrl);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** S11a: do not write fail/recover screenshots when filled parameter values may be visible. */
function skipParameterizedScreenshots(scenario: Scenario, step: RefinedStep): boolean {
  return hasParameterRef(step) || scenario.steps.some(hasParameterRef);
}

/** L7-037: AI recovery sees the recorded/redacted scenario, not dataset-materialized secrets. */
function scenarioForRecovery(scenario: Scenario): Scenario {
  return {
    ...scenario,
    steps: scenario.steps.map((step) => stepForRecovery(step))
  };
}

function stepForRecovery(step: RefinedStep): RefinedStep {
  return {
    ...step,
    action: {
      ...step.action,
      descriptor: originalDescriptorForPatch(step)
    }
  };
}

function redactSnapshotForRecovery(
  snapshot: { url: string; title: string; text: string; values: Record<string, string> },
  scenario: Scenario
): { url: string; title: string; text: string; values: Record<string, string> } {
  const parameterized = scenario.steps.filter(
    (step) => step.action.parameterRef !== undefined && step.action.parameterRef.length > 0
  );
  if (parameterized.length === 0) {
    return snapshot;
  }
  const secrets = new Set<string>();
  const values: Record<string, string> = { ...snapshot.values };
  for (const step of parameterized) {
    const selector = step.action.descriptor.selector;
    if (Object.hasOwn(values, selector)) {
      const live = values[selector];
      if (live !== undefined && live.length > 0) {
        secrets.add(live);
      }
      values[selector] = '';
    }
    for (const argument of step.action.descriptor.arguments ?? []) {
      if (argument.length > 0) {
        secrets.add(argument);
      }
    }
  }
  let text = snapshot.text;
  const ordered = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of ordered) {
    text = text.split(secret).join('');
  }
  return { ...snapshot, values, text };
}

async function datasetLoadFailure(input: {
  scenario: Scenario;
  resolved: ReturnType<typeof resolveRunnerOptions>;
  options: RunScenarioHooks & { driver: PageDriver };
  error: unknown;
  runId: string;
  startedAt: Date;
  smartModel: string;
  multimodal: boolean;
  warnings: string[];
}): Promise<RunScenarioResult> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  input.warnings.push(`dataset: ${message}`);
  const report: ExecutionReport = {
    schemaVersion: 1,
    runId: input.runId,
    sessionId: input.scenario.sessionId,
    startedAt: input.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 1,
    headless: input.resolved.headless,
    aiRecovery: input.resolved.aiRecovery,
    maxAiRetries: input.resolved.maxAiRetries,
    smartModel: input.smartModel,
    multimodal: input.multimodal,
    warnings: unique(input.warnings),
    steps: []
  };
  let runDir: string | undefined;
  if (input.resolved.reportDir !== undefined) {
    runDir = input.resolved.reportDir;
    await writeRunArtifacts({ runDir, report });
  }
  if (input.options.closeDriver === true) {
    await input.options.driver.close();
  }
  const result: RunScenarioResult = { exitCode: 1, report };
  if (runDir !== undefined) {
    result.runDir = runDir;
  }
  return result;
}

async function scenarioWithDataset(
  scenario: Scenario,
  resolved: ReturnType<typeof resolveRunnerOptions>,
  options: RunScenarioHooks
): Promise<Scenario> {
  const datasetPath = resolved.datasetPath ?? options.datasetPath;
  if (datasetPath === undefined || datasetPath.length === 0) {
    return scenario;
  }
  const scriptDir = options.scriptDir;
  const absolute =
    isAbsolute(datasetPath) || scriptDir === undefined
      ? resolve(datasetPath)
      : resolve(scriptDir, datasetPath);
  const raw = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
  return applyDataset(scenario, parseDataset(raw));
}
