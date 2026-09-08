/** Energy VAD on PCM16 mono. Hangover keeps a short tail after speech drops. */

export const VAD_SPEECH_RMS = 400;
export const VAD_HANGOVER_MS = 450;

export type VadState = {
  speaking: boolean;
  hangoverMs: number;
};

export function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of pcm) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / pcm.length);
}

export function createVadState(): VadState {
  return { speaking: false, hangoverMs: 0 };
}

export function pushVad(
  state: VadState,
  pcm: Int16Array,
  frameMs: number,
  threshold: number = VAD_SPEECH_RMS,
  hangoverMs: number = VAD_HANGOVER_MS
): { speaking: boolean; started: boolean; ended: boolean; rms: number } {
  const rms = pcmRms(pcm);
  const active = rms >= threshold;
  const wasSpeaking = state.speaking;
  if (active) {
    state.speaking = true;
    state.hangoverMs = hangoverMs;
  } else if (state.speaking) {
    state.hangoverMs = Math.max(0, state.hangoverMs - frameMs);
    if (state.hangoverMs === 0) {
      state.speaking = false;
    }
  }
  return {
    speaking: state.speaking,
    started: !wasSpeaking && state.speaking,
    ended: wasSpeaking && !state.speaking,
    rms
  };
}

export function frameDurationMs(sampleCount: number, sampleRate: number): number {
  if (sampleRate <= 0) {
    return 0;
  }
  return (sampleCount / sampleRate) * 1000;
}

export type VadUtteranceGate = {
  rms: number;
  speaking: boolean;
  startUtterance: boolean;
  sendFrame: boolean;
  endUtterance: boolean;
};

/** Map one PCM frame onto utterance start / send / end for continuous capture. */
export function gateVadUtterance(
  state: VadState,
  pcm: Int16Array,
  frameMs: number
): VadUtteranceGate {
  const step = pushVad(state, pcm, frameMs);
  return {
    rms: step.rms,
    speaking: step.speaking,
    startUtterance: step.started,
    sendFrame: step.started || step.speaking || step.ended,
    endUtterance: step.ended
  };
}
