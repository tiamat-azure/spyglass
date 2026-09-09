import { describe, expect, it } from 'vitest';
import { waitForProcessExit } from '../../e2e/close-electron.ts';

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
});
