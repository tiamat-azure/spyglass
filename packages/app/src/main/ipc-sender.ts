import type { BrowserWindow } from 'electron';

/** True when `event.sender` is this window's chrome `webContents` (not a guest view). */
export function isChromeIpcSender(
  event: { sender: { id: number; isDestroyed?: () => boolean } },
  win: BrowserWindow | null | undefined
): boolean {
  if (win === undefined || win === null || win.isDestroyed() || win.webContents.isDestroyed()) {
    return false;
  }
  try {
    if (event.sender.isDestroyed?.()) {
      return false;
    }
  } catch {
    return false;
  }
  return event.sender.id === win.webContents.id;
}
