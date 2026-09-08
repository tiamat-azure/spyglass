import { describe, expect, it } from 'vitest';
import { FastTokenBudget } from './budget.ts';

describe('fast token budget (F-70 / F-72 / F-73)', () => {
  it('warns at 50% then halts enrichment at 100% without resetting counters', () => {
    const budget = new FastTokenBudget({ ceiling: 100, warnRatio: 0.5, rateLimitPerMin: 60 });
    expect(budget.decide().decision).toBe('allow');
    budget.recordCall(40, 10);
    const warned = budget.decide();
    expect(warned.decision).toBe('warn');
    expect(warned.snapshot.ratio).toBe(0.5);
    budget.recordCall(40, 10);
    const halted = budget.decide();
    expect(halted.decision).toBe('halt');
    expect(halted.reason).toBe('ceiling');
    expect(budget.snapshot().calls).toBe(2);
    const raised = budget.raiseCeiling(400);
    expect(raised.halt).toBe('none');
    expect(budget.decide().decision).toBe('allow');
  });

  it('trips the per-minute rate limit before the cumulative ceiling', () => {
    let now = 1_000;
    const budget = new FastTokenBudget({
      ceiling: 500_000,
      rateLimitPerMin: 3,
      now: () => now
    });
    budget.recordCall(1, 1);
    now += 10;
    budget.recordCall(1, 1);
    now += 10;
    budget.recordCall(1, 1);
    const halted = budget.decide();
    expect(halted.decision).toBe('halt');
    expect(halted.reason).toBe('rate-limit');
    now += 60_001;
    const resumed = budget.decide();
    expect(resumed.decision).toBe('allow');
  });

  it('offline/disabled halt is independent of token counts', () => {
    const budget = new FastTokenBudget({ ceiling: 1000 });
    budget.setHalt('offline');
    expect(budget.decide().reason).toBe('offline');
    budget.setHalt('disabled');
    expect(budget.decide().reason).toBe('disabled');
  });
});
