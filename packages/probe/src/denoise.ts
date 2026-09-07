export type DenoiseTargetKey = {
  framePath: string[];
  shadowPath: string[];
  cssSelector?: string;
  testId?: string;
  id?: string;
};

export type PendingInput = {
  key: string;
  target: DenoiseTargetKey;
  text: string;
  field: { type?: string; autocomplete?: string; name?: string };
  ts: number;
};

export function targetKey(target: DenoiseTargetKey): string {
  const frame = target.framePath.join('>');
  const shadow = target.shadowPath.join('>');
  return `${frame}|${shadow}|${target.testId ?? ''}|${target.id ?? ''}|${target.cssSelector ?? ''}`;
}

export function shouldCaptureScroll(deltaPx: number, thresholdPx: number): boolean {
  return Number.isFinite(deltaPx) && Math.abs(deltaPx) >= thresholdPx;
}

export function isSignificantKey(key: string): boolean {
  return key === 'Enter' || key === 'Escape' || key === 'Tab';
}

/**
 * Click on a checkbox/radio/select is redundant with the following change/check/select
 * on the same control (F-16).
 */
export function isRedundantClickBeforeChange(
  clickKind: string,
  changeKind: string,
  clickTarget: DenoiseTargetKey,
  changeTarget: DenoiseTargetKey,
  clickTs: number,
  changeTs: number,
  windowMs = 400
): boolean {
  if (clickKind !== 'dom.click') {
    return false;
  }
  if (changeKind !== 'dom.change' && changeKind !== 'dom.check' && changeKind !== 'dom.select') {
    return false;
  }
  if (changeTs - clickTs > windowMs || changeTs < clickTs) {
    return false;
  }
  return targetKey(clickTarget) === targetKey(changeTarget);
}

export class InputAggregator {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly buffers = new Map<string, PendingInput>();

  constructor(
    private readonly aggregationMs: number,
    private readonly flush: (entry: PendingInput) => void
  ) {}

  note(entry: PendingInput): void {
    const key = entry.key;
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.buffers.set(key, entry);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      const buffered = this.buffers.get(key);
      this.buffers.delete(key);
      if (buffered !== undefined) {
        this.flush(buffered);
      }
    }, this.aggregationMs);
    this.pending.set(key, timer);
  }

  flushKey(key: string): void {
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.pending.delete(key);
    }
    const buffered = this.buffers.get(key);
    this.buffers.delete(key);
    if (buffered !== undefined) {
      this.flush(buffered);
    }
  }

  flushAll(): void {
    for (const key of [...this.buffers.keys()]) {
      this.flushKey(key);
    }
  }
}
