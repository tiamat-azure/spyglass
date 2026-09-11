import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('treats a missing file as empty defaults (L7-017)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-store-miss-'));
    const store = new SttUpgradeStore(join(dir, 'stt-upgrade.json'));
    await store.load();
    expect(store.snapshot(dir).refusedPermanently).toBe(false);
    expect(store.snapshot(dir).correctionCount).toBe(0);
  });

  it('throws on corrupt JSON and does not reset a permanent refusal on disk (L7-017)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-store-bad-'));
    const path = join(dir, 'stt-upgrade.json');
    const corrupt = '{not json';
    await writeFile(path, corrupt, 'utf8');
    const store = new SttUpgradeStore(path, { STT_UPGRADE_PROMPT_AFTER: '2' });
    await expect(store.load()).rejects.toThrow(/corrupt stt-upgrade.json: invalid JSON/);
    expect(await readFile(path, 'utf8')).toBe(corrupt);
  });

  it('throws when refusedPermanently is missing rather than defaulting to false (L7-017)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-store-partial-'));
    const path = join(dir, 'stt-upgrade.json');
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, correctionCount: 9 })}\n`, 'utf8');
    const store = new SttUpgradeStore(path);
    await expect(store.load()).rejects.toThrow(/refusedPermanently/);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      schemaVersion: 1,
      correctionCount: 9
    });
  });

  it('serializes concurrent persists so correction counts are not lost (L7-060)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-store-race-'));
    const path = join(dir, 'stt-upgrade.json');
    const store = new SttUpgradeStore(path, { STT_UPGRADE_PROMPT_AFTER: '99' });
    await store.load();
    await Promise.all([
      store.recordCorrection(),
      store.recordCorrection(),
      store.recordCorrection()
    ]);
    expect(store.snapshot(dir).correctionCount).toBe(3);
    const disk = JSON.parse(await readFile(path, 'utf8')) as { correctionCount: number };
    expect(disk.correctionCount).toBe(3);
  });

  it('keeps in-memory state unchanged when atomic persist fails (L7-076)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-store-fail-'));
    const path = join(dir, 'stt-upgrade.json');
    const store = new SttUpgradeStore(path);
    await store.load();
    await store.recordCorrection();
    expect(store.snapshot(dir).correctionCount).toBe(1);
    await rm(path);
    await mkdir(path);
    await expect(store.recordCorrection()).rejects.toThrow();
    expect(store.snapshot(dir).correctionCount).toBe(1);
  });
});
