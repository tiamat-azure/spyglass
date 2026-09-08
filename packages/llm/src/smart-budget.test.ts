import { describe, expect, it } from 'vitest';
import { SmartOperationBudget } from './smart-budget.ts';

describe('SmartOperationBudget', () => {
  it('does not accumulate across operations', () => {
    const budget = new SmartOperationBudget(50);
    budget.beginOperation();
    budget.recordCall(10, 5);
    budget.beginOperation();
    expect(budget.snapshot().calls).toBe(0);
    expect(budget.snapshot().totalTokens).toBe(0);
  });

  it('treats the threshold as a confirm gate, not a session ceiling', () => {
    const budget = new SmartOperationBudget(1_000);
    expect(budget.estimate(999).requiresConfirm).toBe(false);
    expect(budget.estimate(1000).requiresConfirm).toBe(true);
    budget.configure(2_000);
    expect(budget.estimate(1500).requiresConfirm).toBe(false);
  });
});
