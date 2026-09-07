import { contextBridge } from 'electron';

/**
 * Lot -1 preload: typed bridge only. No product IPC channels yet (see docs/contracts/ipc.md).
 */
const spyglass = {
  lot: '-1' as const,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
};

contextBridge.exposeInMainWorld('spyglass', spyglass);

export type SpyglassPreloadApi = typeof spyglass;
