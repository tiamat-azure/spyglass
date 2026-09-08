import { SMART_TOKEN_CONFIRM_DEFAULT } from './constants.ts';

export type SmartEstimate = {
  profile: 'smart';
  estimatedTokens: number;
  threshold: number;
  requiresConfirm: boolean;
};

export type SmartUsage = {
  profile: 'smart';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Per-operation envelope, not a session ceiling (F-71). */
  operationTokens: number;
  threshold: number;
};

/**
 * Smart-profile budget is per operation, not per session (F-71 / ADR-0016).
 * A refinement is one operation: estimate → optional confirm → record usage → reset.
 */
export class SmartOperationBudget {
  private threshold: number;
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;
  private operationTokens = 0;

  constructor(threshold = SMART_TOKEN_CONFIRM_DEFAULT) {
    this.threshold = positiveInt(threshold, SMART_TOKEN_CONFIRM_DEFAULT);
  }

  configure(threshold?: number): void {
    if (threshold !== undefined) {
      this.threshold = positiveInt(threshold, this.threshold);
    }
  }

  estimate(estimatedTokens: number): SmartEstimate {
    const tokens = Math.max(0, Math.floor(estimatedTokens));
    return {
      profile: 'smart',
      estimatedTokens: tokens,
      threshold: this.threshold,
      requiresConfirm: tokens >= this.threshold
    };
  }

  assertConfirm(estimatedTokens: number, confirm: boolean): SmartEstimate | { error: string } {
    const snapshot = this.estimate(estimatedTokens);
    if (snapshot.requiresConfirm && !confirm) {
      return { error: 'smart token confirm required' };
    }
    return snapshot;
  }

  beginOperation(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.calls = 0;
    this.operationTokens = 0;
  }

  recordCall(inputTokens: number, outputTokens: number): SmartUsage {
    this.calls += 1;
    this.inputTokens += Math.max(0, Math.floor(inputTokens));
    this.outputTokens += Math.max(0, Math.floor(outputTokens));
    this.operationTokens = this.inputTokens + this.outputTokens;
    return this.snapshot();
  }

  snapshot(): SmartUsage {
    return {
      profile: 'smart',
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.operationTokens,
      operationTokens: this.operationTokens,
      threshold: this.threshold
    };
  }
}

function positiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
