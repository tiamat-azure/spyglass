import { describe, expect, it } from 'vitest';
import { isChromeIpcSender } from './ipc-sender.ts';

function mockWin(webContentsId: number, opts?: { destroyed?: boolean; wcDestroyed?: boolean }) {
  return {
    isDestroyed: () => opts?.destroyed === true,
    webContents: {
      id: webContentsId,
      isDestroyed: () => opts?.wcDestroyed === true
    }
  } as never;
}

describe('isChromeIpcSender', () => {
  it('accepts the chrome BrowserWindow webContents', () => {
    expect(isChromeIpcSender({ sender: { id: 7, isDestroyed: () => false } }, mockWin(7))).toBe(
      true
    );
  });

  it('rejects a guest or other webContents', () => {
    expect(isChromeIpcSender({ sender: { id: 99, isDestroyed: () => false } }, mockWin(7))).toBe(
      false
    );
  });

  it('rejects null, undefined, or destroyed windows', () => {
    expect(isChromeIpcSender({ sender: { id: 7 } }, null)).toBe(false);
    expect(isChromeIpcSender({ sender: { id: 7 } }, undefined)).toBe(false);
    expect(
      isChromeIpcSender(
        { sender: { id: 7, isDestroyed: () => false } },
        mockWin(7, { destroyed: true })
      )
    ).toBe(false);
    expect(
      isChromeIpcSender(
        { sender: { id: 7, isDestroyed: () => false } },
        mockWin(7, { wcDestroyed: true })
      )
    ).toBe(false);
  });
});
