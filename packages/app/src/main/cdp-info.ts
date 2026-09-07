import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CdpTarget } from '../shared/ipc.ts';

export type CdpEndpointInfo = {
  cdpUrl: string;
  port: number;
  guestUrl: string;
  guestTitle: string;
  targetId?: string;
  updatedAt: string;
};

export async function writeCdpInfoFile(path: string, info: CdpEndpointInfo): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

export function infoFromTarget(
  port: number,
  guestUrl: string,
  guestTitle: string,
  target?: CdpTarget
): CdpEndpointInfo {
  const info: CdpEndpointInfo = {
    cdpUrl: `http://127.0.0.1:${String(port)}`,
    port,
    guestUrl,
    guestTitle,
    updatedAt: new Date().toISOString()
  };
  if (target !== undefined) {
    info.targetId = target.id;
  }
  return info;
}
