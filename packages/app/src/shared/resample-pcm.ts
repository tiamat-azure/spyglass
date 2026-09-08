export const STT_PCM_RATE = 16_000;

function floatToInt16(input: Float32Array): Int16Array {
  const pcm = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] ?? 0;
    pcm[index] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
  }
  return pcm;
}

/** Linear-resample float audio to 16 kHz mono PCM16 for local STT. */
export function resampleToSttPcm(input: Float32Array, sourceRate: number): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0);
  }
  const rate = sourceRate > 0 ? sourceRate : STT_PCM_RATE;
  if (Math.abs(rate - STT_PCM_RATE) < 0.5) {
    return floatToInt16(input);
  }
  const outCount = Math.max(1, Math.round((input.length * STT_PCM_RATE) / rate));
  const resampled = new Float32Array(outCount);
  const scale = (input.length - 1) / Math.max(1, outCount - 1);
  for (let index = 0; index < outCount; index += 1) {
    const src = index * scale;
    const left = Math.floor(src);
    const right = Math.min(input.length - 1, left + 1);
    const frac = src - left;
    const a = input[left] ?? 0;
    const b = input[right] ?? 0;
    resampled[index] = a * (1 - frac) + b * frac;
  }
  return floatToInt16(resampled);
}
