import { describe, expect, it } from 'vitest';
import { SlidingBatcher } from './batch.ts';

describe('sliding batcher (F-24)', () => {
  it('groups items that arrive within the window into a single flush', async () => {
    const flushed: number[][] = [];
    let now = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const batcher = new SlidingBatcher<number>({
      windowMs: 50,
      now: () => now,
      schedule: (fn, ms) => {
        const handle = { at: now + ms, fn };
        timers.push(handle);
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      unschedule: (handle) => {
        const index = timers.indexOf(handle as unknown as { at: number; fn: () => void });
        if (index >= 0) {
          timers.splice(index, 1);
        }
      },
      onFlush: (items) => {
        flushed.push(items);
      }
    });
    batcher.push(1);
    now = 20;
    batcher.push(2);
    now = 50;
    const due = timers.splice(0, timers.length);
    for (const timer of due) {
      timer.fn();
    }
    await batcher.flushNow();
    expect(flushed).toEqual([[1, 2]]);
    batcher.dispose();
  });
});
