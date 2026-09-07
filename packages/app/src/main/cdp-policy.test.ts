import { describe, expect, it } from 'vitest';
import { isRemoteDebuggingRequested } from './cdp-policy.ts';

describe('isRemoteDebuggingRequested', () => {
  it('enables when SPYGLASS_CDP=1 even if packaged', () => {
    expect(isRemoteDebuggingRequested({ SPYGLASS_CDP: '1' }, true)).toBe(true);
  });

  it('enables observe-on-start even if packaged', () => {
    expect(isRemoteDebuggingRequested({ SPYGLASS_OBSERVE_ON_START: '1' }, true)).toBe(true);
  });

  it('enables electron-vite dev (ELECTRON_RENDERER_URL)', () => {
    expect(
      isRemoteDebuggingRequested({ ELECTRON_RENDERER_URL: 'http://localhost:5173' }, true)
    ).toBe(true);
  });

  it('enables unpackaged builds by default (dev / e2e / pnpm start)', () => {
    expect(isRemoteDebuggingRequested({}, false)).toBe(true);
  });

  it('stays off in packaged builds without a flag', () => {
    expect(isRemoteDebuggingRequested({}, true)).toBe(false);
  });

  it('honors SPYGLASS_CDP=0 even when unpackaged', () => {
    expect(isRemoteDebuggingRequested({ SPYGLASS_CDP: '0' }, false)).toBe(false);
  });
});
