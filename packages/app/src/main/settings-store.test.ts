import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore, unavailableVault, xorTestVault } from './settings-store.ts';

describe('settings store (F-29 / safeStorage)', () => {
  it('never writes a plaintext API key to settings.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-settings-'));
    const path = join(dir, 'settings.json');
    const store = new SettingsStore(path, xorTestVault(), {});
    await store.load();
    const result = await store.apply({
      profile: 'fast',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      apiKey: 'sk-live-secret-key-value'
    });
    expect(result.ok).toBe(true);
    expect(result.persistedKey).toBe(true);
    const disk = await readFile(path, 'utf8');
    expect(disk).not.toContain('sk-live-secret-key-value');
    expect(disk).not.toMatch(/"apiKey"/);
    expect(JSON.parse(disk).fast.apiKeyCipher).toBeTypeOf('string');
    const masked = store.masked();
    expect(masked.fast.hasApiKey).toBe(true);
    expect(masked.fast.apiKeyMasked).toBe('••••••••••••');
    expect(store.profileConfig('fast').apiKey).toBe('sk-live-secret-key-value');
  });

  it('keeps the key in memory when encryption is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-settings-'));
    const path = join(dir, 'settings.json');
    const store = new SettingsStore(path, unavailableVault(), {});
    await store.load();
    const result = await store.apply({
      profile: 'fast',
      apiKey: 'sk-memory-only-key-xx'
    });
    expect(result.persistedKey).toBe(false);
    const disk = await readFile(path, 'utf8');
    expect(disk).not.toContain('sk-memory-only-key-xx');
    expect(store.profileConfig('fast').apiKey).toBe('sk-memory-only-key-xx');
  });

  it('persists a raised sessionTokenLimitFast so Settings cannot silently revert it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-settings-'));
    const path = join(dir, 'settings.json');
    const store = new SettingsStore(path, xorTestVault(), {});
    await store.load();
    await store.apply({ sessionTokenLimitFast: 200 });
    expect(store.sessionTokenLimitFast()).toBe(200);
    const disk = JSON.parse(await readFile(path, 'utf8')) as { sessionTokenLimitFast?: number };
    expect(disk.sessionTokenLimitFast).toBe(200);
  });
});
