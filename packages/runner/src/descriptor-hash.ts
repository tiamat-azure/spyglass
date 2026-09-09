import { createHash } from 'node:crypto';
import type { ReplayDescriptor } from '@spyglass/contracts';

/**
 * L7-203: identity allow-list for F-63 hashes. Must cover every
 * `ReplayDescriptor` field that affects replay; a new type field that is
 * omitted here fails typecheck (`satisfies` + exhaustiveness assert).
 */
export const REPLAY_DESCRIPTOR_IDENTITY_KEYS = [
  'type',
  'selector',
  'selectorStrategy',
  'description',
  'fallbackSelectors',
  'arguments',
  'framePath',
  'shadowPath'
] as const satisfies ReadonlyArray<keyof ReplayDescriptor>;

type ReplayDescriptorIdentityKey = (typeof REPLAY_DESCRIPTOR_IDENTITY_KEYS)[number];

type UnlistedReplayDescriptorKey = Exclude<keyof ReplayDescriptor, ReplayDescriptorIdentityKey>;

const _replayDescriptorIdentityComplete: UnlistedReplayDescriptorKey extends never
  ? true
  : UnlistedReplayDescriptorKey = true;

void _replayDescriptorIdentityComplete;

/** Canonical hash of a corrected action descriptor (F-63). */
export function descriptorHash(descriptor: ReplayDescriptor): string {
  const payload = JSON.stringify(canonicalize(descriptor));
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

/** L7-101: branch identity for the full confirmed patch set, not only `toApply[0]`. */
export function patchSetHash(items: ReadonlyArray<{ stepIndex: number; hash: string }>): string {
  const payload = JSON.stringify(
    [...items]
      .map((item) => ({ stepIndex: item.stepIndex, hash: item.hash }))
      .sort((left, right) => left.stepIndex - right.stepIndex)
  );
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function canonicalize(descriptor: ReplayDescriptor): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of REPLAY_DESCRIPTOR_IDENTITY_KEYS) {
    const value = descriptor[key];
    if (value === undefined) {
      continue;
    }
    record[key] = Array.isArray(value) ? [...value] : value;
  }
  return record;
}
