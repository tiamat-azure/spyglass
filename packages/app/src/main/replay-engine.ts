import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Scenario } from '@spyglass/contracts';
import type { LlmGateway } from '@spyglass/llm';
import {
  aiRecoveryEnabled,
  generatedScenarioJsonPath,
  LlmRecoverer,
  loadScenarioFile,
  newRunId,
  type PageDriver,
  type ReplayProgress,
  type RunScenarioResult,
  runScenario,
  scenarioFromRevision
} from '@spyglass/runner';
import { isLlmOffline } from './llm-transport.ts';
import type { RefinedRevisionFile } from './refine-engine.ts';
import type { SessionOrchestrator } from './session-orchestrator.ts';

export type ReplayStartRequest = {
  forceAi?: boolean;
  noAi?: boolean;
};

export type ReplayStartResponse =
  | { ok: true; runId: string }
  | { ok: false; error: string; runId?: string };

export type ReplayEngineDeps = {
  session: () => SessionOrchestrator;
  driver: () => PageDriver;
  gateway: () => LlmGateway;
  model: () => string;
  observe?: () => Promise<{
    ok: boolean;
    observations: Array<{ selector?: string; description?: string }>;
  }>;
  onProgress: (event: ReplayProgress) => void;
  env?: NodeJS.ProcessEnv;
};

export class ReplayEngine {
  private running = false;

  constructor(private readonly deps: ReplayEngineDeps) {}

  async start(request: ReplayStartRequest = {}): Promise<ReplayStartResponse> {
    if (this.running) {
      return { ok: false, error: 'replay already running' };
    }
    const session = this.deps.session();
    const snapshot = session.snapshot();
    if (snapshot.state !== 'finalized' && snapshot.state !== 'replaying') {
      return { ok: false, error: `cannot replay from ${snapshot.state}` };
    }
    const sessionDir = session.currentSessionDir();
    const sessionId = session.currentSessionId();
    if (sessionDir === undefined || sessionId === undefined) {
      return { ok: false, error: 'no session directory' };
    }
    let scenario: Scenario;
    try {
      scenario = await loadFinalizedScenario(sessionDir);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const env = this.deps.env ?? process.env;
    const aiRecovery = aiRecoveryEnabled({
      noAi: request.noAi === true,
      forceAi: request.forceAi === true,
      env
    });
    const runId = newRunId();
    const runDir = join(sessionDir, 'runs', runId);
    await mkdir(runDir, { recursive: true });
    const skipObserve = env.SPYGLASS_LLM_TRANSPORT === 'mock' || isLlmOffline(env);
    const recoverer = aiRecovery
      ? new LlmRecoverer(this.deps.gateway(), skipObserve ? undefined : this.deps.observe)
      : undefined;
    this.running = true;
    session.beginReplay();
    try {
      const result: RunScenarioResult = await runScenario(scenario, {
        driver: this.deps.driver(),
        aiRecovery,
        reportDir: runDir,
        smartModel: this.deps.model(),
        env,
        runId,
        closeDriver: false,
        ...(recoverer !== undefined ? { recoverer } : {}),
        onProgress: this.deps.onProgress
      });
      if (result.exitCode !== 0) {
        const failed = result.report.steps.find((step) => step.status === 'failed');
        const error =
          failed?.error?.trim() || `replay failed with exit code ${String(result.exitCode)}`;
        return { ok: false, error, runId: result.report.runId };
      }
      return { ok: true, runId: result.report.runId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.running = false;
      session.endReplay();
    }
  }
}

export async function loadFinalizedScenario(sessionDir: string): Promise<Scenario> {
  try {
    return await loadScenarioFile(generatedScenarioJsonPath(sessionDir));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
    // Sessions finalized before Lot 6 only have refined/rev-N.json.
  }
  const metaRaw = await readFile(join(sessionDir, 'meta.json'), 'utf8');
  const meta = JSON.parse(metaRaw) as { startUrl?: string };
  const startUrl = typeof meta.startUrl === 'string' ? meta.startUrl : '';
  const refinedDir = join(sessionDir, 'refined');
  const files = (await readdir(refinedDir)).filter((name) => /^rev-\d+\.json$/u.test(name));
  files.sort((left, right) => Number(left.slice(4)) - Number(right.slice(4)));
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const name = files[index];
    if (name === undefined) {
      continue;
    }
    const revision = JSON.parse(
      await readFile(join(refinedDir, name), 'utf8')
    ) as RefinedRevisionFile;
    if (revision.status === 'finalized' && revision.steps.length > 0) {
      return scenarioFromRevision(revision, startUrl);
    }
  }
  throw new Error('no finalized revision');
}
