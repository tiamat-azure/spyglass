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
});
