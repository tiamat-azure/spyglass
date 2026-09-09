import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SttUpgradeStore } from './stt-upgrade-store.ts';

describe('SttUpgradeStore (F-38)', () => {
  it('proposes after the configured correction count and honours permanent refusal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-store-'));
    const store = new SttUpgradeStore(join(dir, 'stt-upgrade.json'), {
      STT_UPGRADE_PROMPT_AFTER: '2'
    });
    await store.load();
    await store.recordCorrection();
    expect(store.snapshot(dir).decision).toBe('silent');
    await store.recordCorrection();
    expect(store.snapshot(dir).decision).toBe('propose');
    await store.refusePermanently();
    expect(store.snapshot(dir).decision).toBe('refused');
    const disk = JSON.parse(await readFile(join(dir, 'stt-upgrade.json'), 'utf8')) as {
      refusedPermanently: boolean;
      correctionCount: number;
    };
    expect(disk.refusedPermanently).toBe(true);
    expect(disk.correctionCount).toBe(2);
  });
});
