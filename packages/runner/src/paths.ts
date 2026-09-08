import { join } from 'node:path';

/** Join path segments with the platform separator (Windows-safe). */
export function runPath(...parts: string[]): string {
  return join(...parts);
}

export function screenshotFileName(stepIndex: number, kind: 'fail' | 'recover'): string {
  return `step-${String(stepIndex)}-${kind}.jpg`;
}
