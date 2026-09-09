import { STT_LARGE_SHA256 } from '@spyglass/stt';

/**
 * E18a: `SPYGLASS_STT_UPGRADE_FAKE` and env `STT_LARGE_SHA256` are unpackaged
 * or `NODE_ENV=test` only. Packaged production builds must use the real
 * download and the pinned digest.
 */
export function allowSttUpgradeEnvEscapes(
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): boolean {
  if (!packaged) {
    return true;
  }
  return env.NODE_ENV === 'test';
}

export function sttUpgradeFakeEnabled(
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): boolean {
  return allowSttUpgradeEnvEscapes(env, packaged) && env.SPYGLASS_STT_UPGRADE_FAKE === '1';
}

export function resolveSttLargeExpectedSha256(
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): string {
  if (!allowSttUpgradeEnvEscapes(env, packaged)) {
    return STT_LARGE_SHA256;
  }
  const fromEnv = env.STT_LARGE_SHA256;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return STT_LARGE_SHA256;
}
