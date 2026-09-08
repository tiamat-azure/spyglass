export type BudgetHalt = 'none' | 'ceiling' | 'rate-limit' | 'offline' | 'disabled' | 'error';

export type BudgetDecision = 'allow' | 'warn' | 'halt';

export type UsageSnapshot = {
  profile: 'fast' | 'smart';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  ceiling: number;
  ratio: number;
  warnRatio: number;
  halt: BudgetHalt;
  rateLimitPerMin: number;
  callsInWindow: number;
  warned: boolean;
};

export type FastTokenBudgetOptions = {
  ceiling?: number;
  warnRatio?: number;
  rateLimitPerMin?: number;
  errorRetryMs?: number;
  now?: () => number;
};

const ERROR_RETRY_MS_DEFAULT = 15_000;

/**
 * Fast-profile session breaker (F-28, F-70, F-72, F-73, ADR-0016).
 * Recording is not this object's concern — callers must never stop capture.
 */
export class FastTokenBudget {
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;
  private readonly callTimes: number[] = [];
  private warned = false;
  private halt: BudgetHalt = 'none';
  private errorAt = 0;
  private ceiling: number;
  private warnRatio: number;
  private rateLimitPerMin: number;
  private readonly errorRetryMs: number;
  private readonly now: () => number;

  constructor(options: FastTokenBudgetOptions = {}) {
    this.ceiling = positiveInt(options.ceiling, 500_000);
    this.warnRatio = clampRatio(options.warnRatio ?? 0.5);
    this.rateLimitPerMin = positiveInt(options.rateLimitPerMin, 60);
    this.errorRetryMs = positiveInt(options.errorRetryMs, ERROR_RETRY_MS_DEFAULT);
    this.now = options.now ?? Date.now;
  }

  snapshot(): UsageSnapshot {
    const totalTokens = this.inputTokens + this.outputTokens;
    return {
      profile: 'fast',
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens,
      ceiling: this.ceiling,
      ratio: this.ceiling === 0 ? 1 : totalTokens / this.ceiling,
      warnRatio: this.warnRatio,
      halt: this.halt,
      rateLimitPerMin: this.rateLimitPerMin,
      callsInWindow: this.callsInWindow(),
      warned: this.warned
    };
  }

  /** Decide whether a new fast call may be issued. */
  decide(): {
    decision: BudgetDecision;
    reason: BudgetHalt | 'warn' | 'none';
    snapshot: UsageSnapshot;
  } {
    this.pruneWindow();
    if (this.halt === 'ceiling' || this.halt === 'offline' || this.halt === 'disabled') {
      return { decision: 'halt', reason: this.halt, snapshot: this.snapshot() };
    }
    if (this.halt === 'error') {
      if (this.now() - this.errorAt < this.errorRetryMs) {
        return { decision: 'halt', reason: 'error', snapshot: this.snapshot() };
      }
      this.halt = 'none';
    }
    const total = this.inputTokens + this.outputTokens;
    if (total >= this.ceiling) {
      this.halt = 'ceiling';
      return { decision: 'halt', reason: 'ceiling', snapshot: this.snapshot() };
    }
    if (this.callsInWindow() >= this.rateLimitPerMin) {
      this.halt = 'rate-limit';
      return { decision: 'halt', reason: 'rate-limit', snapshot: this.snapshot() };
    }
    if (this.halt === 'rate-limit') {
      this.halt = 'none';
    }
    const ratio = this.ceiling === 0 ? 1 : total / this.ceiling;
    if (ratio >= this.warnRatio && !this.warned) {
      this.warned = true;
      return { decision: 'warn', reason: 'warn', snapshot: this.snapshot() };
    }
    return { decision: 'allow', reason: 'none', snapshot: this.snapshot() };
  }

  recordCall(inputTokens: number, outputTokens: number): UsageSnapshot {
    this.calls += 1;
    this.inputTokens += Math.max(0, Math.floor(inputTokens));
    this.outputTokens += Math.max(0, Math.floor(outputTokens));
    this.callTimes.push(this.now());
    const total = this.inputTokens + this.outputTokens;
    if (total >= this.ceiling) {
      this.halt = 'ceiling';
    }
    return this.snapshot();
  }

  setHalt(halt: BudgetHalt): UsageSnapshot {
    this.halt = halt;
    if (halt === 'error') {
      this.errorAt = this.now();
    }
    return this.snapshot();
  }

  /** F-72 raise-ceiling restores narration without touching recording. */
  raiseCeiling(nextCeiling?: number): UsageSnapshot {
    const bump = nextCeiling ?? this.ceiling * 2;
    this.ceiling = Math.max(this.ceiling + 1, Math.floor(bump));
    if (this.halt === 'ceiling') {
      this.halt = 'none';
    }
    this.warned = false;
    return this.snapshot();
  }

  configure(options: {
    ceiling?: number;
    warnRatio?: number;
    rateLimitPerMin?: number;
  }): UsageSnapshot {
    if (options.ceiling !== undefined) {
      this.ceiling = positiveInt(options.ceiling, this.ceiling);
    }
    if (options.warnRatio !== undefined) {
      this.warnRatio = clampRatio(options.warnRatio);
    }
    if (options.rateLimitPerMin !== undefined) {
      this.rateLimitPerMin = positiveInt(options.rateLimitPerMin, this.rateLimitPerMin);
    }
    const total = this.inputTokens + this.outputTokens;
    if (total >= this.ceiling) {
      if (this.halt === 'none' || this.halt === 'ceiling' || this.halt === 'rate-limit') {
        this.halt = 'ceiling';
      }
    } else if (this.halt === 'ceiling') {
      this.halt = 'none';
      this.warned = false;
    }
    return this.snapshot();
  }

  markWarned(): void {
    this.warned = true;
  }

  resetSession(): UsageSnapshot {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.calls = 0;
    this.callTimes.length = 0;
    this.warned = false;
    if (this.halt === 'ceiling' || this.halt === 'rate-limit' || this.halt === 'error') {
      this.halt = 'none';
    }
    return this.snapshot();
  }

  private callsInWindow(): number {
    this.pruneWindow();
    return this.callTimes.length;
  }

  private pruneWindow(): void {
    const cutoff = this.now() - 60_000;
    while (this.callTimes.length > 0 && (this.callTimes[0] ?? 0) <= cutoff) {
      this.callTimes.shift();
    }
  }
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(0.99, Math.max(0.01, value));
}
