import { randomBytes } from 'node:crypto';

export function newSessionId(now = new Date()): string {
  const stamp = now.toISOString().replaceAll(/[-:]/g, '').replace('T', '').slice(0, 14);
  const suffix = randomBytes(3).toString('hex');
  return `ses_${stamp}_${suffix}`;
}

export function formatEventId(index: number): string {
  return `evt_${String(index).padStart(6, '0')}`;
}

export function formatSnapshotRef(index: number): string {
  return `snap_${String(index).padStart(6, '0')}`;
}

export function formatScreenshotRef(index: number): string {
  return `shot_${String(index).padStart(6, '0')}`;
}

export function newProbeNonce(): string {
  return randomBytes(16).toString('hex');
}
