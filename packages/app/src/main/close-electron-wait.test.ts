import { describe, expect, it } from 'vitest';
import { KILL_EXIT_GRACE_MS, waitForProcessExit } from '../../e2e/close-electron.ts';

describe('closeElectron waitForProcessExit (L7-117)', () => {
  it('does not short-circuit on killed when exitCode is still null', async () => {
    let exited = false;
    const child = {
      kill: () => true,
      killed: true,
      exitCode: null as number | null,
      once: (_event: 'exit', listener: () => void) => {
        setTimeout(() => {
          exited = true;
          listener();
        }, 25);
      }
    };
    await waitForProcessExit(child);
    expect(exited).toBe(true);
  });

  it('returns immediately when exitCode is already set', async () => {
    let onceCalled = false;
    await waitForProcessExit({
      kill: () => true,
      killed: true,
      exitCode: 1,
      once: () => {
        onceCalled = true;
      }
    });
    expect(onceCalled).toBe(false);
  });

  it('honours the grace timeout when once is missing (L7-158)', async () => {
    const started = Date.now();
    await waitForProcessExit({
      kill: () => true,
      killed: true,
      exitCode: null
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(KILL_EXIT_GRACE_MS - 100);
  });
});
