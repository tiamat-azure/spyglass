import { type ProbeInjectConfig, spyglassProbeMain } from './runtime.ts';

export function buildProbeSource(config: ProbeInjectConfig): string {
  return `(${spyglassProbeMain.toString()})(${JSON.stringify(config)});`;
}
