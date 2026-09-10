import { STT_LARGE_SHA256 } from '@spyglass/stt';
import { describe, expect, it } from 'vitest';
import {
  allowSttUpgradeEnvEscapes,
  publishResolvedSttModelDir,
  resolveSttLargeExpectedSha256,
  sttUpgradeFakeEnabled
} from './stt-upgrade-policy.ts';

const FAKE_DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('E18a STT upgrade env escapes', () => {
  it('allows unpackaged builds (dev / e2e / pnpm start)', () => {
    expect(allowSttUpgradeEnvEscapes({ NODE_ENV: 'production' }, false)).toBe(true);
    expect(sttUpgradeFakeEnabled({ SPYGLASS_STT_UPGRADE_FAKE: '1' }, false)).toBe(true);
    expect(resolveSttLargeExpectedSha256({ STT_LARGE_SHA256: FAKE_DIGEST }, false)).toBe(
      FAKE_DIGEST
    );
  });

  it('allows NODE_ENV=test even when packaged', () => {
    const env = {
      NODE_ENV: 'test',
      SPYGLASS_STT_UPGRADE_FAKE: '1',
      STT_LARGE_SHA256: FAKE_DIGEST
    };
    expect(allowSttUpgradeEnvEscapes(env, true)).toBe(true);
    expect(sttUpgradeFakeEnabled(env, true)).toBe(true);
    expect(resolveSttLargeExpectedSha256(env, true)).toBe(FAKE_DIGEST);
  });

  it('ignores FAKE and env SHA256 in packaged production', () => {
    const env = {
      NODE_ENV: 'production',
      SPYGLASS_STT_UPGRADE_FAKE: '1',
      STT_LARGE_SHA256: FAKE_DIGEST
    };
    expect(allowSttUpgradeEnvEscapes(env, true)).toBe(false);
    expect(sttUpgradeFakeEnabled(env, true)).toBe(false);
    expect(resolveSttLargeExpectedSha256(env, true)).toBe(STT_LARGE_SHA256);
  });

  it('ignores escapes in packaged builds when NODE_ENV is unset or development', () => {
    expect(sttUpgradeFakeEnabled({ SPYGLASS_STT_UPGRADE_FAKE: '1' }, true)).toBe(false);
    expect(
      sttUpgradeFakeEnabled({ NODE_ENV: 'development', SPYGLASS_STT_UPGRADE_FAKE: '1' }, true)
    ).toBe(false);
    expect(resolveSttLargeExpectedSha256({ STT_LARGE_SHA256: FAKE_DIGEST }, true)).toBe(
      STT_LARGE_SHA256
    );
  });

  it('does not treat FAKE values other than 1 as enabled', () => {
    expect(sttUpgradeFakeEnabled({ SPYGLASS_STT_UPGRADE_FAKE: 'true' }, false)).toBe(false);
    expect(sttUpgradeFakeEnabled({}, false)).toBe(false);
  });

  it('falls back to the pinned digest when env SHA256 is empty', () => {
    expect(resolveSttLargeExpectedSha256({ STT_LARGE_SHA256: '  ' }, false)).toBe(STT_LARGE_SHA256);
    expect(resolveSttLargeExpectedSha256({}, false)).toBe(STT_LARGE_SHA256);
  });
});

describe('L37a-sync STT model dir publish', () => {
  it('writes the fallback dir onto STT_MODEL_DIR when unset or blank', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(publishResolvedSttModelDir(env, '/userData/whisper')).toBe('/userData/whisper');
    expect(env.STT_MODEL_DIR).toBe('/userData/whisper');
    const blank: NodeJS.ProcessEnv = { STT_MODEL_DIR: '  ' };
    expect(publishResolvedSttModelDir(blank, '/userData/whisper')).toBe('/userData/whisper');
    expect(blank.STT_MODEL_DIR).toBe('/userData/whisper');
  });

  it('trims an existing STT_MODEL_DIR and writes it back', () => {
    const env: NodeJS.ProcessEnv = { STT_MODEL_DIR: ' /opt/whisper ' };
    expect(publishResolvedSttModelDir(env, '/userData/whisper')).toBe('/opt/whisper');
    expect(env.STT_MODEL_DIR).toBe('/opt/whisper');
  });
});
