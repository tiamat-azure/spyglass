import type { RawEvent } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { createMockTransport, LlmGateway } from './client.ts';
import { LLM_FAST_MODEL_DEFAULT, LLM_SMART_MODEL_DEFAULT } from './constants.ts';
import {
  allowedRefineIds,
  bindLlmProposal,
  canFinalize,
  collectRetractedIds,
  estimateRefineTokens,
  isReplayDescriptorSufficient,
  parseRefineResponse,
  refineFromRaw,
  sourceEventsAreTraceable,
  unconfirmedWeaks,
  urlGlob,
  weakGroup
} from './refine.ts';
import { SmartOperationBudget } from './smart-budget.ts';

function click(
  id: string,
  ts: number,
  extra: Partial<RawEvent> = {},
  url = 'https://app.example.test/start'
): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_refine',
    ts,
    kind: 'dom.click',
    stepIndex: extra.stepIndex ?? 1,
    target: {
      tag: 'button',
      role: 'button',
      id: 'step-1',
      testId: 'step-1',
      accessibleName: 'Start',
      framePath: ['main'],
      shadowPath: []
    },
    action: {
      type: 'click',
      selector: '[data-testid="step-1"]',
      selectorStrategy: 'testId',
      description: 'Clic sur « Start »',
      fallbackSelectors: ['#step-1'],
      framePath: ['main'],
      shadowPath: []
    },
    page: { url, title: 'Demo' },
    narration: { mode: 'template', text: 'Tu as cliqué sur « Start »' },
    ...extra
  };
}

function fill(id: string, ts: number): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_refine',
    ts,
    kind: 'dom.input',
    stepIndex: 2,
    target: {
      tag: 'input',
      id: 'step-2',
      testId: 'step-2',
      name: 'displayName',
      accessibleName: 'Name',
      framePath: ['main'],
      shadowPath: []
    },
    action: {
      type: 'fill',
      selector: '[data-testid="step-2"]',
      selectorStrategy: 'testId',
      framePath: ['main'],
      shadowPath: []
    },
    value: { masked: false, text: 'Ada' },
    page: { url: 'https://app.example.test/form', title: 'Form' }
  };
}

function nav(id: string, ts: number, url: string): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_refine',
    ts,
    kind: 'nav.load',
    page: { url, title: 'Next' }
  };
}

function voice(id: string, ts: number, correlatedEventId: string, text: string): RawEvent {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'ses_refine',
    ts,
    kind: 'voice.final',
    voice: {
      text,
      relation: 'after',
      correlatedEventId
    }
  };
}

const control = (id: string, kind: RawEvent['kind'], ts: number): RawEvent => ({
  schemaVersion: 1,
  id,
  sessionId: 'ses_refine',
  ts,
  kind
});

function fixtureRaw(): RawEvent[] {
  return [
    control('evt_000001', 'record.start', 1),
    click('evt_000002', 2, { stepIndex: 1 }, 'https://app.example.test/start'),
    nav('evt_000003', 3, 'https://app.example.test/form'),
    fill('evt_000004', 4),
    click('evt_000005', 5, { stepIndex: 3 }, 'https://app.example.test/form'),
    click('evt_000006', 6, { stepIndex: 3 }, 'https://app.example.test/form'),
    {
      schemaVersion: 1,
      id: 'evt_000007',
      sessionId: 'ses_refine',
      ts: 7,
      kind: 'step.retracted',
      retracts: 'evt_000005'
    },
    control('evt_000008', 'record.stop', 8)
  ];
}

describe('refineFromRaw', () => {
  it('builds intent → action → verification with sourceEvents from fixture raw', () => {
    const steps = refineFromRaw(fixtureRaw(), 'balanced');
    expect(steps.length).toBeGreaterThan(0);
    const first = steps[0];
    expect(first?.intent.length).toBeGreaterThan(0);
    expect(first?.action.type).toBe('click');
    expect(first?.verification).toBeDefined();
    expect(first?.sourceEvents.every((id) => id.startsWith('evt_'))).toBe(true);
    const ids = new Set(fixtureRaw().map((event) => event.id));
    expect(sourceEventsAreTraceable(steps, ids)).toBe(true);
    expect(JSON.stringify(steps)).not.toContain('Ada');
  });

  it('ignores retracted steps and never references them', () => {
    const events = fixtureRaw();
    expect(collectRetractedIds(events).has('evt_000005')).toBe(true);
    const steps = refineFromRaw(events, 'balanced');
    const blob = JSON.stringify(steps);
    expect(blob).not.toContain('evt_000005');
    expect(blob).not.toContain('evt_000007');
  });

  it('F-42 allow-list excludes retracted ids (LOT4-R4)', () => {
    const events = fixtureRaw();
    const steps = refineFromRaw(events, 'balanced').map((step) => ({
      ...step,
      sourceEvents: ['evt_000005']
    }));
    const allIds = new Set(events.map((event) => event.id));
    expect(allIds.has('evt_000005')).toBe(true);
    expect(sourceEventsAreTraceable(steps, allIds)).toBe(true);
    expect(allowedRefineIds(events).has('evt_000005')).toBe(false);
    expect(sourceEventsAreTraceable(steps, allowedRefineIds(events))).toBe(false);
  });

  it('merges consecutive identical clicks when aggressiveness is not conservative', () => {
    const events: RawEvent[] = [
      click('evt_000010', 10, { stepIndex: 1 }, 'https://app.example.test/form'),
      click('evt_000011', 11, { stepIndex: 1 }, 'https://app.example.test/form')
    ];
    const conservative = refineFromRaw(events, 'conservative');
    const balanced = refineFromRaw(events, 'balanced');
    expect(conservative.length).toBe(2);
    expect(balanced.length).toBe(1);
    expect(balanced[0]?.sourceEvents).toEqual(['evt_000010', 'evt_000011']);
  });

  it('classifies strong vs weak and routine vs doubtful', () => {
    const spokenClick = click('evt_000020', 20, { stepIndex: 4 }, 'https://app.example.test/a');
    const events: RawEvent[] = [
      spokenClick,
      voice('evt_000021', 21, 'evt_000020', 'Je démarre le parcours'),
      nav('evt_000022', 22, 'https://app.example.test/b'),
      fill('evt_000023', 23),
      click('evt_000024', 24, { stepIndex: 5 }, 'https://app.example.test/b')
    ];
    const steps = refineFromRaw(events, 'balanced');
    const strong = steps.find((step) => step.verification.strength === 'strong');
    expect(strong?.intent).toBe('Je démarre le parcours');
    expect(strong?.verification.confirmedByUser).toBe(true);
    const routine = steps.find(
      (step) => step.verification.weakReason === 'observable-state-change'
    );
    const doubtfulValue = steps.find((step) => step.verification.weakReason === 'value-assertion');
    const doubtfulNone = steps.find(
      (step) => step.verification.weakReason === 'no-observable-change'
    );
    expect(routine === undefined || weakGroup(routine.verification.weakReason) === 'routine').toBe(
      true
    );
    expect(doubtfulValue !== undefined || doubtfulNone !== undefined).toBe(true);
    if (doubtfulValue !== undefined) {
      expect(weakGroup(doubtfulValue.verification.weakReason)).toBe('doubtful');
    }
  });

  it('blocks finalize while a weak is unconfirmed', () => {
    const steps = refineFromRaw(
      [click('evt_000030', 30, {}, 'https://app.example.test/x')],
      'balanced'
    );
    expect(steps[0]?.verification.strength).toBe('weak');
    expect(canFinalize(steps)).toBe(false);
    expect(unconfirmedWeaks(steps)).toHaveLength(1);
    const confirmed = steps.map((step) => ({
      ...step,
      verification: { ...step.verification, confirmedByUser: true }
    }));
    expect(canFinalize(confirmed)).toBe(true);
  });

  it('globs file URLs including Chromium file://null host', () => {
    expect(urlGlob('file:///workspace/packages/app/out/renderer/lot1-fixture.html')).toBe(
      '**/lot1-fixture.html'
    );
    expect(urlGlob('file://null/workspace/packages/app/out/renderer/lot1-fixture.html')).toBe(
      '**/lot1-fixture.html'
    );
  });

  it('keeps local verification when the model sends a raw file URL', () => {
    const events: RawEvent[] = [
      click('evt_000040', 40, { stepIndex: 1 }, 'file://null/workspace/app/start.html'),
      nav('evt_000041', 41, 'file://null/workspace/app/lot1-fixture.html')
    ];
    const bound = bindLlmProposal(
      [
        {
          intent: 'Je clique sur lot1-link',
          actionType: 'click',
          sourceEvents: ['evt_000040'],
          verification: {
            type: 'elementVisible',
            expected: 'file://null/workspace/app/lot1-fixture.html',
            strength: 'weak',
            weakReason: 'no-observable-change'
          }
        }
      ],
      events,
      'balanced'
    );
    expect('error' in bound).toBe(false);
    if ('error' in bound) {
      return;
    }
    expect(bound[0]?.verification.type).toBe('urlMatches');
    expect(bound[0]?.verification.expected).toBe('**/lot1-fixture.html');
    expect(bound[0]?.verification.expected).not.toContain('workspace');
    expect(bound[0]?.verification.weakReason).toBe('observable-state-change');
    expect(bound[0]?.intent).toBe('Je clique sur lot1-link');
  });

  it('ignores model actionType so local action and verification stay paired (P2-2)', () => {
    const events: RawEvent[] = [fill('evt_000004', 4)];
    const bound = bindLlmProposal(
      [
        {
          intent: 'Je saisis Ada',
          actionType: 'click',
          sourceEvents: ['evt_000004']
        }
      ],
      events,
      'balanced'
    );
    expect('error' in bound).toBe(false);
    if ('error' in bound) {
      return;
    }
    expect(bound[0]?.action.type).toBe('fill');
    expect(bound[0]?.action.descriptor.type).toBe('fill');
    expect(bound[0]?.verification.type).toBe('valueEquals');
    expect(bound[0]?.verification.weakReason).toBe('value-assertion');
    expect(bound[0]?.intent).toBe('Je saisis Ada');
  });
});

describe('descriptor sufficiency (I-07)', () => {
  it('treats testId descriptors as sufficient and empty selectors as not', () => {
    expect(
      isReplayDescriptorSufficient({
        type: 'click',
        selector: '[data-testid="step-1"]',
        selectorStrategy: 'testId'
      })
    ).toBe(true);
    expect(isReplayDescriptorSufficient({ type: 'click', selector: '' })).toBe(false);
    expect(
      isReplayDescriptorSufficient({
        type: 'click',
        selector: 'div > span',
        selectorStrategy: 'css'
      })
    ).toBe(false);
  });
});

describe('smart refine transport', () => {
  it('uses the mock smart transport and keeps sourceEvents traceable', async () => {
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, tokensPerCall: 120 }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: LLM_FAST_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: '',
          timeoutMs: 200
        },
        smart: {
          provider: 'anthropic',
          model: LLM_SMART_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: '',
          timeoutMs: 200
        }
      })
    });
    const events = fixtureRaw();
    const result = await gateway.refine(events, 'balanced');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.source).toBe('smart');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(sourceEventsAreTraceable(result.steps, new Set(events.map((event) => event.id)))).toBe(
      true
    );
    expect(JSON.stringify(result.steps)).not.toContain('Ada');
  });

  it('falls back locally when the smart transport is unreachable', async () => {
    const gateway = new LlmGateway({
      transport: createMockTransport({ delayMs: 1, fail: 'network cut' }),
      profiles: () => ({
        fast: {
          provider: 'anthropic',
          model: LLM_FAST_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: '',
          timeoutMs: 50
        },
        smart: {
          provider: 'anthropic',
          model: LLM_SMART_MODEL_DEFAULT,
          baseUrl: 'https://api.anthropic.com',
          apiKey: '',
          timeoutMs: 50
        }
      })
    });
    const result = await gateway.refine(fixtureRaw(), 'balanced');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/network cut/);
    }
  });

  it('rejects unknown sourceEvents from the model', () => {
    const allowed = new Set(['evt_000002']);
    const parsed = parseRefineResponse(
      JSON.stringify({
        steps: [
          {
            intent: 'nope',
            actionType: 'click',
            sourceEvents: ['evt_999999']
          }
        ]
      }),
      allowed
    );
    expect('error' in parsed).toBe(true);
    const bound = bindLlmProposal(
      [
        {
          intent: 'nope',
          actionType: 'click',
          sourceEvents: ['evt_999999']
        }
      ],
      fixtureRaw(),
      'balanced'
    );
    expect('error' in bound).toBe(true);
  });
});

describe('smart operation budget (F-71 / F-74)', () => {
  it('estimates tokens and requires confirm above the per-operation threshold', () => {
    const budget = new SmartOperationBudget(100);
    const estimate = estimateRefineTokens(fixtureRaw(), 'balanced');
    expect(estimate).toBeGreaterThan(0);
    const snap = budget.estimate(estimate);
    expect(snap.requiresConfirm).toBe(true);
    expect(budget.assertConfirm(estimate, false)).toMatchObject({
      error: 'smart token confirm required'
    });
    expect(budget.assertConfirm(estimate, true)).toMatchObject({ requiresConfirm: true });
    budget.beginOperation();
    const usage = budget.recordCall(40, 20);
    expect(usage.profile).toBe('smart');
    expect(usage.operationTokens).toBe(60);
    budget.beginOperation();
    expect(budget.snapshot().operationTokens).toBe(0);
  });
});
