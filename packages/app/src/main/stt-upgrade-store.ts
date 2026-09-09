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
    let rawText: string;
    try {
      rawText = await readFile(this.path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.disk = {
          schemaVersion: 1,
          correctionCount: 0,
          refusedPermanently: false
        };
        return;
      }
      throw new Error(`unreadable stt-upgrade.json: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error('corrupt stt-upgrade.json: invalid JSON');
    }
    this.disk = parseSttUpgradeDisk(parsed);
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

/** L7-017: incomplete JSON must not reset a permanent refusal. */
export function parseSttUpgradeDisk(raw: unknown): SttUpgradeDisk {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('corrupt stt-upgrade.json: not an object');
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error('corrupt stt-upgrade.json: schemaVersion must be 1');
  }
  if (
    typeof record.correctionCount !== 'number' ||
    !Number.isFinite(record.correctionCount) ||
    record.correctionCount < 0
  ) {
    throw new Error('corrupt stt-upgrade.json: correctionCount');
  }
  if (typeof record.refusedPermanently !== 'boolean') {
    throw new Error('corrupt stt-upgrade.json: refusedPermanently');
  }
  return {
    schemaVersion: 1,
    correctionCount: Math.floor(record.correctionCount),
    refusedPermanently: record.refusedPermanently
  };
}
