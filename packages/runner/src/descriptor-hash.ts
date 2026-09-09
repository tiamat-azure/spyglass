import { createHash } from 'node:crypto';
import type { ReplayDescriptor } from '@spyglass/contracts';

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
  const record: Record<string, unknown> = {
    type: descriptor.type,
    selector: descriptor.selector
  };
  if (descriptor.selectorStrategy !== undefined) {
    record.selectorStrategy = descriptor.selectorStrategy;
  }
  if (descriptor.description !== undefined) {
    record.description = descriptor.description;
  }
  if (descriptor.fallbackSelectors !== undefined) {
    record.fallbackSelectors = [...descriptor.fallbackSelectors];
  }
  if (descriptor.arguments !== undefined) {
    record.arguments = [...descriptor.arguments];
  }
  if (descriptor.framePath !== undefined) {
    record.framePath = [...descriptor.framePath];
  }
  if (descriptor.shadowPath !== undefined) {
    record.shadowPath = [...descriptor.shadowPath];
  }
  return record;
}
