export type DenoiseTargetKey = {
  framePath: string[];
  shadowPath: string[];
  cssSelector?: string;
  testId?: string;
  id?: string;
  tag?: string;
};

export const CLICK_CHANGE_WINDOW_MS = 400;

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
  windowMs = CLICK_CHANGE_WINDOW_MS
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

/** Label click that toggles a checkbox/select in the same frame (F-16). */
export function isLabelClickForControlChange(
  clickKind: string,
  changeKind: string,
  clickTarget: DenoiseTargetKey,
  changeTarget: DenoiseTargetKey,
  clickTs: number,
  changeTs: number,
  windowMs = CLICK_CHANGE_WINDOW_MS
): boolean {
  if (clickKind !== 'dom.click' || clickTarget.tag !== 'label') {
    return false;
  }
  if (changeKind !== 'dom.change' && changeKind !== 'dom.check' && changeKind !== 'dom.select') {
    return false;
  }
  if (changeTs - clickTs > windowMs || changeTs < clickTs) {
    return false;
  }
  return clickTarget.framePath.join('>') === changeTarget.framePath.join('>');
}

export function isDenoisedClickForChange(
  clickKind: string,
  changeKind: string,
  clickTarget: DenoiseTargetKey,
  changeTarget: DenoiseTargetKey,
  clickTs: number,
  changeTs: number,
  windowMs = CLICK_CHANGE_WINDOW_MS
): boolean {
  return (
    isRedundantClickBeforeChange(
      clickKind,
      changeKind,
      clickTarget,
      changeTarget,
      clickTs,
      changeTs,
      windowMs
    ) ||
    isLabelClickForControlChange(
      clickKind,
      changeKind,
      clickTarget,
      changeTarget,
      clickTs,
      changeTs,
      windowMs
    )
  );
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
