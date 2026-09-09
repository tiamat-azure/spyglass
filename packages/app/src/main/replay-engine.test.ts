import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep } from '@spyglass/contracts';
import { createMockTransport, LlmGateway } from '@spyglass/llm';
import { MemoryPageDriver } from '@spyglass/runner';
import { describe, expect, it } from 'vitest';
import { loadFinalizedScenario, ReplayEngine } from './replay-engine.ts';
import type { SessionOrchestrator } from './session-orchestrator.ts';

function clickStep(selector: string): RefinedStep {
  return {
    index: 0,
    intent: 'Je clique',
    action: {
      type: 'click',
      descriptor: { type: 'click', selector, selectorStrategy: 'css' }
    },
    verification: {
      type: 'elementVisible',
      expected: selector,
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: ['evt_000001']
  };
}

describe('ReplayEngine', () => {
  it('loads a finalized revision and refuses non-finalized sessions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#go')]
      }),
      'utf8'
    );
    const scenario = await loadFinalizedScenario(dir);
    expect(scenario.startUrl).toBe('https://exemple.test/start');
    expect(scenario.steps[0]?.action.descriptor.selector).toBe('#go');

    await mkdir(join(dir, 'generated'), { recursive: true });
    await writeFile(
      join(dir, 'generated', 'scenario.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test/generated',
        steps: [clickStep('#from-generated')]
      }),
      'utf8'
    );
    const preferred = await loadFinalizedScenario(dir);
    expect(preferred.startUrl).toBe('https://exemple.test/generated');
    expect(preferred.steps[0]?.action.descriptor.selector).toBe('#from-generated');

    const session = {
      snapshot: () => ({ state: 'reviewing', since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => undefined,
      endReplay: () => undefined
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () => new MemoryPageDriver({ elements: [{ selector: '#go', visible: true }] }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      onProgress: () => undefined
    });
    const refused = await engine.start();
    expect(refused.ok).toBe(false);
  });

  it('does not beginReplay when scenario load fails (B10b)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-b10b-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    let begins = 0;
    let ends = 0;
    const session = {
      snapshot: () => ({ state: 'finalized', since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => {
        begins += 1;
      },
      endReplay: () => {
        ends += 1;
      }
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () => new MemoryPageDriver({ elements: [{ selector: '#go', visible: true }] }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      env: { CI: '1' },
      onProgress: () => undefined
    });
    const started = await engine.start({ noAi: true });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error).toMatch(/no finalized revision/);
    }
    expect(begins).toBe(0);
    expect(ends).toBe(0);
  });

  it('ignores leftover generated unless the latest rev is finalized (G56a / L6-056)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-g56a-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await mkdir(join(dir, 'generated'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'reviewing',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#go')]
      }),
      'utf8'
    );
    await writeFile(
      join(dir, 'generated', 'scenario.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test/leftover',
        steps: [clickStep('#leftover')]
      }),
      'utf8'
    );
    await expect(loadFinalizedScenario(dir)).rejects.toThrow(/no finalized revision/);

    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#go')]
      }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-2.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 2,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'reviewing',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#rev2')]
      }),
      'utf8'
    );
    const older = await loadFinalizedScenario(dir);
    expect(older.startUrl).toBe('https://exemple.test/start');
    expect(older.steps[0]?.action.descriptor.selector).toBe('#go');
    expect(older.steps[0]?.action.descriptor.selector).not.toBe('#leftover');
  });

  it('runs a finalized scenario without AI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#go')]
      }),
      'utf8'
    );
    let state = 'finalized';
    const session = {
      snapshot: () => ({ state, since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => {
        state = 'replaying';
      },
      endReplay: () => {
        state = 'finalized';
      }
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () => new MemoryPageDriver({ elements: [{ selector: '#go', visible: true }] }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      env: { CI: '1' },
      onProgress: () => undefined
    });
    const started = await engine.start({ noAi: true });
    expect(started.ok).toBe(true);
    expect(state).toBe('finalized');
  });

  it('returns ok:false when the run exits non-zero (L5-ADV-04)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#missing')]
      }),
      'utf8'
    );
    let state = 'finalized';
    const session = {
      snapshot: () => ({ state, since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => {
        state = 'replaying';
      },
      endReplay: () => {
        state = 'finalized';
      }
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () => new MemoryPageDriver({ elements: [{ selector: '#go', visible: true }] }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      env: { CI: '1' },
      onProgress: () => undefined
    });
    const started = await engine.start({ noAi: true });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.length).toBeGreaterThan(0);
      expect(started.runId).toMatch(/^run_/);
    }
    expect(state).toBe('finalized');
  });

  it('fails closed on corrupt generated/scenario.json instead of refined fallback (L6-020)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-corrupt-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await mkdir(join(dir, 'generated'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#go')]
      }),
      'utf8'
    );
    await writeFile(join(dir, 'generated', 'scenario.json'), '{', 'utf8');
    await expect(loadFinalizedScenario(dir)).rejects.toThrow();
    await writeFile(
      join(dir, 'generated', 'scenario.json'),
      JSON.stringify({ sessionId: 'ses_r', steps: 'nope' }),
      'utf8'
    );
    await expect(loadFinalizedScenario(dir)).rejects.toThrow(/invalid scenario/i);

    let state = 'finalized';
    let begins = 0;
    let ends = 0;
    const session = {
      snapshot: () => ({ state, since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => {
        begins += 1;
        state = 'replaying';
      },
      endReplay: () => {
        ends += 1;
        state = 'finalized';
      }
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () => new MemoryPageDriver({ elements: [{ selector: '#go', visible: true }] }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      env: { CI: '1' },
      onProgress: () => undefined
    });
    const started = await engine.start({ noAi: true });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error).toMatch(/invalid scenario/i);
    }
    expect(state).toBe('finalized');
    expect(begins).toBe(0);
    expect(ends).toBe(0);
  });

  it('picks the highest-numbered finalized rev when generated is missing (L6-022)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-revsort-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    const revision = (n: number, selector: string): string =>
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: n,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep(selector)]
      });
    await writeFile(join(dir, 'refined', 'rev-2.json'), revision(2, '#rev2'), 'utf8');
    await writeFile(join(dir, 'refined', 'rev-10.json'), revision(10, '#rev10'), 'utf8');
    const scenario = await loadFinalizedScenario(dir);
    expect(scenario.steps[0]?.action.descriptor.selector).toBe('#rev10');
  });

  it('does not let a corrupt older rev-N.json break a newer finalized replay (L6-062)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-l6062-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(join(dir, 'refined', 'rev-1.json'), '{', 'utf8');
    await writeFile(
      join(dir, 'refined', 'rev-2.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 2,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#rev2')]
      }),
      'utf8'
    );
    const scenario = await loadFinalizedScenario(dir);
    expect(scenario.steps[0]?.action.descriptor.selector).toBe('#rev2');

    await writeFile(
      join(dir, 'refined', 'rev-3.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 3,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'reviewing',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#rev3')]
      }),
      'utf8'
    );
    const older = await loadFinalizedScenario(dir);
    expect(older.steps[0]?.action.descriptor.selector).toBe('#rev2');
  });

  it('fails closed when the highest-numbered rev-N.json is corrupt (C68a / L6-068)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-c68a-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await mkdir(join(dir, 'generated'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#rev1')]
      }),
      'utf8'
    );
    await writeFile(join(dir, 'refined', 'rev-2.json'), '{', 'utf8');
    await writeFile(
      join(dir, 'generated', 'scenario.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        startUrl: 'https://exemple.test/leftover',
        steps: [clickStep('#leftover')]
      }),
      'utf8'
    );
    await expect(loadFinalizedScenario(dir)).rejects.toThrow(/corrupt revision rev-2\.json/);
  });

  it('consumes next/stop issued before the step gate is installed (L7-004)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-pending-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    const second: RefinedStep = {
      ...clickStep('#b'),
      index: 1,
      sourceEvents: ['evt_000002'],
      verification: {
        type: 'elementVisible',
        expected: '#b',
        strength: 'strong',
        confirmedByUser: true
      }
    };
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#a'), second]
      }),
      'utf8'
    );
    let state = 'finalized';
    const session = {
      snapshot: () => ({ state, since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => {
        state = 'replaying';
      },
      endReplay: () => {
        state = 'finalized';
      }
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () =>
        new MemoryPageDriver({
          elements: [
            { selector: '#a', visible: true },
            { selector: '#b', visible: true }
          ]
        }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      env: { CI: '1' },
      onProgress: () => undefined
    });
    const started = engine.start({ noAi: true, stepByStep: true });
    engine.next();
    engine.next();
    const result = await started;
    expect(result.ok).toBe(true);

    const stopped = engine.start({ noAi: true, stepByStep: true });
    engine.next();
    engine.stop();
    const halted = await stopped;
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.error).toMatch(/stopped by user/);
    }
  });

  it('ignores idle stop/next so the next stepwise run is not aborted at step 0 (L7-021)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-replay-idle-'));
    await mkdir(join(dir, 'refined'), { recursive: true });
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    const second: RefinedStep = {
      ...clickStep('#b'),
      index: 1,
      sourceEvents: ['evt_000002'],
      verification: {
        type: 'elementVisible',
        expected: '#b',
        strength: 'strong',
        confirmedByUser: true
      }
    };
    await writeFile(
      join(dir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_r',
        revision: 1,
        createdAt: new Date().toISOString(),
        aggressiveness: 'balanced',
        model: 'claude-sonnet-4-5-20250929',
        status: 'finalized',
        observeEnrichment: false,
        estimatedTokens: 1,
        actualTokens: 1,
        source: 'smart',
        steps: [clickStep('#a'), second]
      }),
      'utf8'
    );
    let state = 'finalized';
    const session = {
      snapshot: () => ({ state, since: 0 }),
      currentSessionDir: () => dir,
      currentSessionId: () => 'ses_r',
      beginReplay: () => {
        state = 'replaying';
      },
      endReplay: () => {
        state = 'finalized';
      }
    };
    const engine = new ReplayEngine({
      session: () => session as unknown as SessionOrchestrator,
      driver: () =>
        new MemoryPageDriver({
          elements: [
            { selector: '#a', visible: true },
            { selector: '#b', visible: true }
          ]
        }),
      gateway: () =>
        new LlmGateway({
          transport: createMockTransport({ delayMs: 1 }),
          profiles: () => ({
            fast: { provider: 'x', model: 'x', baseUrl: '', apiKey: '', timeoutMs: 10 },
            smart: {
              provider: 'x',
              model: 'claude-sonnet-4-5-20250929',
              baseUrl: '',
              apiKey: '',
              timeoutMs: 10
            }
          })
        }),
      model: () => 'claude-sonnet-4-5-20250929',
      env: { CI: '1' },
      onProgress: () => undefined
    });
    engine.stop();
    engine.next();
    engine.next();
    const started = engine.start({ noAi: true, stepByStep: true });
    engine.next();
    engine.next();
    const result = await started;
    expect(result.ok).toBe(true);
  });
});
