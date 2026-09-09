import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  largeModelPresent,
  parseUpgradePromptAfter,
  type SttUpgradeDecision,
  shouldProposeUpgrade
} from '@spyglass/stt';

export type SttUpgradeDisk = {
  schemaVersion: 1;
  correctionCount: number;
  refusedPermanently: boolean;
};

export class SttUpgradeStore {
  private disk: SttUpgradeDisk = {
    schemaVersion: 1,
    correctionCount: 0,
    refusedPermanently: false
  };

  constructor(
    private readonly path: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<SttUpgradeDisk>;
      this.disk = {
        schemaVersion: 1,
        correctionCount:
          typeof parsed.correctionCount === 'number' && parsed.correctionCount >= 0
            ? Math.floor(parsed.correctionCount)
            : 0,
        refusedPermanently: parsed.refusedPermanently === true
      };
    } catch {
      this.disk = { schemaVersion: 1, correctionCount: 0, refusedPermanently: false };
    }
  }

  snapshot(modelDir: string): {
    correctionCount: number;
    refusedPermanently: boolean;
    largeAvailable: boolean;
    decision: SttUpgradeDecision;
  } {
    const largeAvailable = largeModelPresent(modelDir);
    const decision = shouldProposeUpgrade({
      correctionCount: this.disk.correctionCount,
      refusedPermanently: this.disk.refusedPermanently,
      largeAvailable,
      after: parseUpgradePromptAfter(this.env)
    });
    return {
      correctionCount: this.disk.correctionCount,
      refusedPermanently: this.disk.refusedPermanently,
      largeAvailable,
      decision
    };
  }

  async recordCorrection(): Promise<void> {
    this.disk.correctionCount += 1;
    await this.persist();
  }

  async refusePermanently(): Promise<void> {
    this.disk.refusedPermanently = true;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(this.disk, null, 2)}\n`, 'utf8');
  }
}

export function sttUpgradeStorePath(userData: string): string {
  return join(userData, 'stt-upgrade.json');
}
