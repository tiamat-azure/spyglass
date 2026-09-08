export type BatcherOptions<T> = {
  windowMs: number;
  onFlush: (items: T[]) => Promise<void> | void;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (handle: ReturnType<typeof setTimeout>) => void;
};

/**
 * Sliding-window batcher (F-24). First item starts the window; later items
 * join until the window elapses, then one flush runs.
 */
export class SlidingBatcher<T> {
  private readonly items: T[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private windowStarted = 0;
  private readonly windowMs: number;
  private readonly onFlush: (items: T[]) => Promise<void> | void;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly unschedule: (handle: ReturnType<typeof setTimeout>) => void;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: BatcherOptions<T>) {
    this.windowMs = Math.max(0, options.windowMs);
    this.onFlush = options.onFlush;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? setTimeout;
    this.unschedule = options.unschedule ?? clearTimeout;
  }

  push(item: T): void {
    const now = this.now();
    if (this.items.length === 0) {
      this.windowStarted = now;
    }
    this.items.push(item);
    this.arm(now);
  }

  async flushNow(): Promise<void> {
    await this.flush();
  }

  pendingCount(): number {
    return this.items.length;
  }

  dispose(): void {
    if (this.timer !== undefined) {
      this.unschedule(this.timer);
      this.timer = undefined;
    }
    this.items.length = 0;
  }

  private arm(now: number): void {
    if (this.timer !== undefined) {
      this.unschedule(this.timer);
    }
    const elapsed = now - this.windowStarted;
    const wait = Math.max(0, this.windowMs - elapsed);
    this.timer = this.schedule(() => {
      this.timer = undefined;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    if (this.timer !== undefined) {
      this.unschedule(this.timer);
      this.timer = undefined;
    }
    const batch = this.items.splice(0, this.items.length);
    if (batch.length === 0) {
      return;
    }
    const run = this.chain.then(
      () => this.onFlush(batch),
      () => this.onFlush(batch)
    );
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    await run;
  }
}
