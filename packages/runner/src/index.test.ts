import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.ts';
import { resolveReportDir } from './launch.ts';
import { MemoryPageDriver } from './memory-driver.ts';
import { aiRecoveryEnabled, isCiEnv, parseRunnerArgv, resolveMaxAiRetries } from './options.ts';
import { RUNNER_PACKAGE, runnerPackageName } from './package-name.ts';
import { runPath, screenshotFileName, traceFileName } from './paths.ts';
import { StaticRecoverer } from './recover.ts';
import { runScenario } from './run.ts';

function clickStep(index: number, selector: string, intent = 'Je clique'): RefinedStep {
  return {
    index,
    intent,
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector,
        selectorStrategy: 'css',
        description: intent
      }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
  };
}

function scenario(steps: RefinedStep[], startUrl = 'https://exemple.test/start'): Scenario {
  return {
    schemaVersion: 1,
    sessionId: 'ses_lot5',
    startUrl,
    steps
  };
}

describe('@spyglass/runner package', () => {
  it('reserves the npm scope name', () => {
    expect(runnerPackageName()).toBe('@spyglass/runner');
    expect(RUNNER_PACKAGE.startsWith('@spyglass/')).toBe(true);
  });
});

describe('F-58 / F-60 CLI flags and CI default', () => {
  it('parses F-58 flags', () => {
    const parsed = parseRunnerArgv(
      [
        'scenario.json',
        '--headless',
        '--base-url',
        'https://app.test',
        '--timeout',
        '5000',
        '--max-ai-retries',
        '2',
        '--no-ai',
        '--report',
        'runs/out',
        '--trace'
      ],
      {}
    );
    expect(parsed.headless).toBe(true);
    expect(parsed.baseUrl).toBe('https://app.test');
    expect(parsed.timeoutMs).toBe(5000);
    expect(parsed.maxAiRetries).toBe(2);
    expect(parsed.aiRecovery).toBe(false);
    expect(parsed.trace).toBe(true);
    expect(parsed.reportDir).toBe('runs/out');
    expect(parsed.scenarioPath).toBe('scenario.json');
  });

  it('uses Windows-safe artifact names', () => {
    expect(screenshotFileName(2, 'fail')).toBe('step-2-fail.jpg');
    expect(screenshotFileName(0, 'recover')).toBe('step-0-recover.jpg');
    expect(traceFileName()).toBe('trace.zip');
    expect(screenshotFileName(1, 'fail')).not.toMatch(/[\\/]/);
  });

  it('prints F-58 flags on --help without launching a browser', async () => {
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await runCli(['--help'], { CI: '1' });
      expect(code).toBe(0);
      const text = chunks.join('');
      expect(text).toMatch(/--headless/);
      expect(text).toMatch(/--no-ai/);
      expect(text).toMatch(/--ai/);
      expect(text).toMatch(/--max-ai-retries/);
      expect(text).toMatch(/--report/);
      expect(text).toMatch(/--trace/);
      expect(text).toMatch(/dirname\(<scenario\.json>\)/);
      expect(text).toMatch(/process\.cwd\(\)/);
      expect(text).toMatch(/A19a/);
    } finally {
      process.stdout.write = write;
    }
  });

  it('resolves relative --report from the scenario directory, not cwd (A19a)', () => {
    const scenarioDir = join(tmpdir(), 'spyglass-a19a-scenario');
    expect(resolveReportDir('out', scenarioDir, 'run_x')).toBe(resolve(scenarioDir, 'out'));
    expect(resolveReportDir('/abs/reports', scenarioDir, 'run_x')).toBe(resolve('/abs/reports'));
    expect(resolveReportDir(undefined, scenarioDir, 'run_x')).toBe(
      runPath(scenarioDir, '..', 'runs', 'run_x')
    );
  });

  it('disables recovery when CI=1 unless --ai, and --no-ai always wins', () => {
    expect(isCiEnv({ CI: '1' })).toBe(true);
    expect(isCiEnv({ CI: 'true' })).toBe(true);
    expect(isCiEnv({})).toBe(false);
    expect(aiRecoveryEnabled({ env: { CI: '1' } })).toBe(false);
    expect(aiRecoveryEnabled({ forceAi: true, env: { CI: '1' } })).toBe(true);
    expect(aiRecoveryEnabled({ noAi: true, forceAi: true, env: {} })).toBe(false);
    expect(aiRecoveryEnabled({ env: {} })).toBe(true);
    expect(parseRunnerArgv(['s.json', '--ai'], { CI: '1' }).aiRecovery).toBe(true);
    expect(parseRunnerArgv(['s.json', '--no-ai', '--ai'], { CI: '1' }).aiRecovery).toBe(false);
  });

  it('reads MAX_AI_RETRIES from env with default 3', () => {
    expect(resolveMaxAiRetries(undefined, {})).toBe(3);
    expect(resolveMaxAiRetries(undefined, { MAX_AI_RETRIES: '5' })).toBe(5);
    expect(resolveMaxAiRetries(1, { MAX_AI_RETRIES: '5' })).toBe(1);
  });
});

describe('F-50 deterministic replay without LLM', () => {
  it('replays cached descriptors and advances only after verification (F-51)', async () => {
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '#go', visible: true, text: 'Go' },
        { selector: '#next', visible: true, text: 'Next' }
      ]
    });
    const llmCalls = { count: 0 };
    const result = await runScenario(scenario([clickStep(0, '#go'), clickStep(1, '#next')]), {
      driver,
      aiRecovery: true,
      env: {},
      recoverer: {
        recover: async () => {
          llmCalls.count += 1;
          return undefined;
        }
      }
    });
    expect(result.exitCode).toBe(0);
    expect(driver.clicks).toEqual(['#go', '#next']);
    expect(result.report.steps.every((step) => step.mode === 'script')).toBe(true);
    expect(result.report.steps.every((step) => step.verificationOk)).toBe(true);
    expect(llmCalls.count).toBe(0);
    expect(result.suggestedPatch).toBeUndefined();
  });

  it('does not advance when verification fails', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#go', visible: true }]
    });
    const steps = [
      clickStep(0, '#go'),
      {
        ...clickStep(1, '#missing'),
        verification: {
          type: 'elementVisible' as const,
          expected: '#never',
          strength: 'strong' as const,
          confirmedByUser: true
        }
      }
    ];
    steps[0] = {
      ...steps[0],
      verification: {
        type: 'elementVisible',
        expected: '#never',
        strength: 'strong',
        confirmedByUser: true,
        timeoutMs: 50
      }
    };
    const result = await runScenario(scenario(steps), {
      driver,
      aiRecovery: false,
      env: {}
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.steps[0]?.status).toBe('failed');
    expect(result.report.steps[1]?.status).toBe('skipped');
    expect(driver.clicks).toEqual(['#go']);
  });
});

describe('F-52–F-57 bounded AI recovery and suggested patch', () => {
  it('recovers a broken selector, resumes deterministic, writes unapplied patch', async () => {
    const driver = new MemoryPageDriver({
      url: 'https://exemple.test/start',
      elements: [
        { selector: '[data-testid="step-1"]', visible: true, text: 'Start' },
        { selector: '#two', visible: true, text: 'Two' }
      ]
    });
    const broken = clickStep(0, '#does-not-exist', 'Je clique sur Start');
    broken.verification.expected = '[data-testid="step-1"]';
    broken.verification.timeoutMs = 50;
    const originalSelector = broken.action.descriptor.selector;
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-lot5-'));
    const result = await runScenario(scenario([broken, clickStep(1, '#two')]), {
      driver,
      aiRecovery: true,
      env: {},
      reportDir: dir,
      recoverer: new StaticRecoverer(
        {
          type: 'click',
          selector: '[data-testid="step-1"]',
          selectorStrategy: 'testId'
        },
        'testid inchangé'
      )
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.steps[0]?.mode).toBe('AI');
    expect(result.report.steps[0]?.status).toBe('passed');
    expect(result.report.steps[1]?.mode).toBe('script');
    expect(result.suggestedPatch?.applied).toBe(false);
    expect(result.suggestedPatch?.patches[0]?.scope).toBe('action.descriptor');
    expect(result.suggestedPatch?.patches[0]?.suggested.selector).toBe('[data-testid="step-1"]');
    expect(broken.action.descriptor.selector).toBe(originalSelector);
    const disk = JSON.parse(await readFile(join(dir, 'suggested-patch.json'), 'utf8')) as {
      applied: boolean;
    };
    expect(disk.applied).toBe(false);
    const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as {
      exitCode: number;
    };
    expect(report.exitCode).toBe(0);
  });

  it('exits non-zero with a detailed report when retries are exhausted (F-55)', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#real', visible: true }]
    });
    const step = clickStep(0, '#broken');
    step.verification.timeoutMs = 40;
    const result = await runScenario(scenario([step]), {
      driver,
      aiRecovery: true,
      maxAiRetries: 2,
      env: {},
      recoverer: new StaticRecoverer({ type: 'click', selector: '#still-broken' }, 'nope')
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.steps[0]?.status).toBe('failed');
    expect(result.report.steps[0]?.mode).toBe('AI');
    expect(result.report.steps[0]?.attempts).toBeGreaterThan(2);
    expect(result.report.steps[0]?.error).toMatch(/exhausted/);
    expect(result.suggestedPatch).toBeUndefined();
  });
});

describe('F-60 --no-ai / CI fail clean without keys', () => {
  it('fails without calling recoverer when recovery is off', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#real', visible: true }]
    });
    const step = clickStep(0, '#broken');
    step.verification.timeoutMs = 40;
    let recovered = 0;
    const result = await runScenario(scenario([step]), {
      driver,
      aiRecovery: false,
      env: { CI: '1' },
      recoverer: {
        recover: async () => {
          recovered += 1;
          return {
            descriptor: { type: 'click', selector: '#real' },
            diagnosis: 'should not run',
            confidence: 1,
            observeUsed: false
          };
        }
      }
    });
    expect(result.exitCode).toBe(1);
    expect(recovered).toBe(0);
    expect(result.report.aiRecovery).toBe(false);
    expect(result.report.steps[0]?.mode).toBe('script');
    expect(result.suggestedPatch).toBeUndefined();
  });
});

describe('F-61 multimodal warning', () => {
  it('warns non-blocking when the smart model is text-only', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#go', visible: true }]
    });
    const result = await runScenario(scenario([clickStep(0, '#go')]), {
      driver,
      aiRecovery: true,
      smartModel: 'text-only-local',
      env: {}
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.multimodal).toBe(false);
    expect(result.report.warnings.some((line) => line.includes('not multimodal'))).toBe(true);
  });

  it('journals the text-DOM fallback on each recovery attempt', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '[data-testid="step-1"]', visible: true }]
    });
    const step = clickStep(0, '#does-not-exist');
    step.verification.expected = '[data-testid="step-1"]';
    step.verification.timeoutMs = 40;
    const progress: string[] = [];
    const result = await runScenario(scenario([step]), {
      driver,
      aiRecovery: true,
      smartModel: 'text-only-local',
      env: {},
      recoverer: new StaticRecoverer(
        { type: 'click', selector: '[data-testid="step-1"]' },
        'testid'
      ),
      onProgress: (event) => {
        progress.push(event.message);
      }
    });
    expect(result.exitCode).toBe(0);
    expect(progress.some((line) => line.includes('text DOM only (F-61)'))).toBe(true);
  });

  it('pins the I-05 smart snapshot by default', async () => {
    const driver = new MemoryPageDriver({
      elements: [{ selector: '#go', visible: true }]
    });
    const result = await runScenario(scenario([clickStep(0, '#go')]), {
      driver,
      env: {}
    });
    expect(result.report.smartModel).toBe('claude-sonnet-4-5-20250929');
    expect(result.report.multimodal).toBe(true);
  });
});
