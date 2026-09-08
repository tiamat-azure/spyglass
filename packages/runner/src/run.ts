import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
import type { PageDriver } from './driver.ts';
import {
  type RunScenarioOptions,
  type RunScenarioResult,
  resolveRunnerOptions
} from './options.ts';
import { runPath, screenshotFileName } from './paths.ts';
import type { Recoverer, RecoveryAttempt } from './recover.ts';
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

export type RunScenarioHooks = RunScenarioOptions & {
  driver: PageDriver;
  recoverer?: Recoverer;
  onProgress?: (event: ReplayProgress) => void;
  runId?: string;
  closeDriver?: boolean;
};

const TEXT_ONLY_WARNING =
  'Smart model is not multimodal; recovery will use the text DOM only (F-61).';

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replaceAll(/[-:]/g, '').replace('T', '').slice(0, 14);
  return `run_${stamp}_${randomBytes(3).toString('hex')}`;
}

export async function runScenario(
  scenario: Scenario,
  options: RunScenarioHooks
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
  const original = scenario.steps.map((step) => cloneDescriptor(step.action.descriptor));
  const stepReports: ExecutionStepReport[] = [];
  const patches: SuggestedPatchEntry[] = [];
  let failed = false;

  const startUrl = joinBaseUrl(resolved.baseUrl, scenario.startUrl);
  await options.driver.goto(startUrl);

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
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

    if (!verify.ok) {
      screenshotRef = await captureFailure(options.driver, resolved.reportDir, step.index, 'fail');
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
        scenario,
        step,
        driver: options.driver,
        recoverer: options.recoverer,
        timeoutMs,
        maxAiRetries: Math.max(1, resolved.maxAiRetries),
        multimodal,
        beforeDom,
        originalError: error ?? 'verification failed',
        runId,
        ...(resolved.reportDir !== undefined ? { reportDir: resolved.reportDir } : {}),
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {})
      });
      attempts = recovered.attempts;
      mode = 'AI';
      if (recovered.ok) {
        verify = { ok: true };
        error = undefined;
        patches.push({
          stepIndex: step.index,
          scope: 'action.descriptor',
          original: original[index] ?? cloneDescriptor(step.action.descriptor),
          suggested: recovered.descriptor,
          diagnosis: recovered.diagnosis,
          confidence: recovered.confidence
        });
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
          (await captureFailure(options.driver, resolved.reportDir, step.index, 'recover'));
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
    sessionId: scenario.sessionId,
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
      ? {
          schemaVersion: 1,
          runId,
          sessionId: scenario.sessionId,
          applied: false,
          patches
        }
      : undefined;

  let runDir: string | undefined;
  if (resolved.reportDir !== undefined) {
    runDir = resolved.reportDir;
    await writeRunArtifacts({
      runDir,
      report,
      ...(suggestedPatch !== undefined ? { suggestedPatch } : {})
    });
  }

  if (options.closeDriver === true) {
    await options.driver.close();
  }

  const result: RunScenarioResult = { exitCode: report.exitCode, report };
  if (suggestedPatch !== undefined) {
    result.suggestedPatch = suggestedPatch;
  }
  if (runDir !== undefined) {
    result.runDir = runDir;
  }
  return result;
}

async function recoverStep(input: {
  scenario: Scenario;
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
    screenshotRef = await captureFailure(
      input.driver,
      input.reportDir,
      input.step.index,
      'recover'
    );
    const context = {
      scenario: input.scenario,
      step: input.step,
      attempt,
      error: lastError,
      beforeDom: input.beforeDom,
      afterDom,
      multimodal: input.multimodal,
      ...(screenshotRef !== undefined ? { screenshotPath: screenshotRef } : {})
    };
    const recovered: RecoveryAttempt | undefined = await input.recoverer.recover(context);
    if (recovered === undefined) {
      lastError = `recovery produced no patch (attempt ${String(attempt)})`;
      continue;
    }
    const acted = await performAction(input.driver, recovered.descriptor);
    if (!acted.ok) {
      lastError = acted.error;
      continue;
    }
    const verify = await verifyStep(input.driver, input.step, input.timeoutMs);
    if (verify.ok) {
      return {
        ok: true,
        descriptor: recovered.descriptor,
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
  if (baseUrl === undefined || baseUrl.length === 0) {
    return startUrl;
  }
  try {
    return new URL(startUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
  } catch {
    return startUrl;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
