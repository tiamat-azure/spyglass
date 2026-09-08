import { describe, expect, it } from 'vitest';
import { resampleToSttPcm, STT_PCM_RATE } from './resample-pcm.ts';

describe('resampleToSttPcm', () => {
  it('keeps 16 kHz audio at the same length', () => {
    const input = Float32Array.from({ length: 1600 }, (_, index) => Math.sin(index / 12));
    const pcm = resampleToSttPcm(input, STT_PCM_RATE);
    expect(pcm.length).toBe(1600);
    expect(Math.abs(pcm[4] ?? 0)).toBeGreaterThan(0);
  });

  it('downsamples 48 kHz to 16 kHz', () => {
    const input = Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index / 20));
    const pcm = resampleToSttPcm(input, 48_000);
    expect(pcm.length).toBe(1600);
  });
});
