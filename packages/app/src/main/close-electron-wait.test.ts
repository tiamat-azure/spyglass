import { describe, expect, it } from 'vitest';
import {
  closeElectron,
  KILL_EXIT_GRACE_MS,
  killElectronChild,
  waitForProcessExit
} from '../../e2e/close-electron.ts';

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

  it.skipIf(process.platform === 'win32')('SIGKILLs the child when not on Windows', () => {
    const signals: NodeJS.Signals[] = [];
    killElectronChild({
      kill: (signal) => {
        if (signal !== undefined) {
          signals.push(signal);
        }
        return true;
      },
      pid: 4242
    });
    expect(signals).toEqual(['SIGKILL']);
  });

  it('is a no-op when the child handle is missing', () => {
    expect(() => killElectronChild(undefined)).not.toThrow();
    expect(() => killElectronChild(null)).not.toThrow();
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

  it('rethrows non-timeout close() errors without SIGKILL (L7-191)', async () => {
    let killed = false;
    await expect(
      closeElectron({
        close: async () => {
          throw new Error('quit failed');
        },
        process: () => ({
          kill: () => {
            killed = true;
            return true;
          },
          pid: 99
        })
      })
    ).rejects.toThrow(/quit failed/);
    expect(killed).toBe(false);
  });
});
