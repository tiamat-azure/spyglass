import { describe, expect, it } from 'vitest';
import { STT_PACKAGE, sidecarStatus } from './index.ts';

describe('@spyglass/stt scaffold', () => {
  it('reports scaffold status without a runtime', () => {
    expect(STT_PACKAGE).toBe('@spyglass/stt');
    expect(sidecarStatus()).toBe('scaffold');
  });
});
