import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCREENSHOT_RETENTION } from '@spyglass/probe';
import { formatScreenshotRef, formatSnapshotRef } from './session-ids.ts';

export type RetentionPolicy = {
  screenshotLimit: number;
};

export class CaptureRetention {
  private readonly pinned = new Set<number>();
  private readonly screenshots = new Map<number, string>();
  private readonly snapshots = new Map<number, string>();

  constructor(
    private readonly sessionDir: string,
    private readonly policy: RetentionPolicy = { screenshotLimit: SCREENSHOT_RETENTION }
  ) {}

  async init(): Promise<void> {
    await mkdir(join(this.sessionDir, 'snapshots'), { recursive: true });
    await mkdir(join(this.sessionDir, 'screenshots'), { recursive: true });
  }

  pinFailure(stepIndex: number): void {
    this.pinned.add(stepIndex);
  }

  async writeSnapshot(stepIndex: number, payload: unknown): Promise<string> {
    const ref = formatSnapshotRef(stepIndex);
    const file = join(this.sessionDir, 'snapshots', `${ref}.json`);
    await writeFile(file, `${JSON.stringify(payload)}\n`, 'utf8');
    this.snapshots.set(stepIndex, ref);
    return ref;
  }

  async writeScreenshot(stepIndex: number, jpeg: Buffer): Promise<string> {
    const ref = formatScreenshotRef(stepIndex);
    const file = join(this.sessionDir, 'screenshots', `${ref}.jpg`);
    await writeFile(file, jpeg);
    this.screenshots.set(stepIndex, ref);
    await this.pruneScreenshots();
    return ref;
  }

  private async pruneScreenshots(): Promise<void> {
    const limit = this.policy.screenshotLimit;
    const indexes = [...this.screenshots.keys()].sort((a, b) => a - b);
    if (indexes.length <= limit) {
      return;
    }
    const cutoff = indexes[indexes.length - limit];
    if (cutoff === undefined) {
      return;
    }
    for (const index of indexes) {
      if (index >= cutoff || this.pinned.has(index)) {
        continue;
      }
      const ref = this.screenshots.get(index);
      this.screenshots.delete(index);
      if (ref === undefined) {
        continue;
      }
      try {
        await unlink(join(this.sessionDir, 'screenshots', `${ref}.jpg`));
      } catch {
        // already gone
      }
    }
  }

  async listScreenshotFiles(): Promise<string[]> {
    try {
      const names = await readdir(join(this.sessionDir, 'screenshots'));
      return names.filter((name) => name.endsWith('.jpg')).sort();
    } catch {
      return [];
    }
  }
}
