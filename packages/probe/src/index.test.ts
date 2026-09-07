import { describe, expect, it } from 'vitest';
import { PROBE_PACKAGE, probePackageName } from './index.ts';

describe('@spyglass/probe scaffold', () => {
  it('exposes the reserved package name', () => {
    expect(probePackageName()).toBe(PROBE_PACKAGE);
  });
});
