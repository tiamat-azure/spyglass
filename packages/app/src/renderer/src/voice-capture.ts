import { resampleToSttPcm } from '../../shared/resample-pcm.ts';

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 1600;

type VoiceApi = {
  voice: {
    start: (mode: 'hold' | 'continuous') => Promise<{
      ok: boolean;
      fakeCapture: boolean;
      error?: string;
    }>;
    stop: () => Promise<{ ok: boolean }>;
    abort: () => Promise<{ ok: boolean }>;
    setMode: (mode: 'hold' | 'continuous') => Promise<{ ok: boolean }>;
    frame: (pcm: ArrayBuffer) => void;
    onPartial: (callback: (payload: { text: string }) => void) => () => void;
    onFinal: (callback: (payload: { text: string }) => void) => () => void;
    onLevel: (callback: (payload: { rms: number }) => void) => () => void;
  };
};

export type VoiceController = {
  mode: () => 'hold' | 'continuous';
  setMode: (mode: 'hold' | 'continuous') => void;
  setArmed: (armed: boolean) => void;
  holding: () => boolean;
  startHold: () => Promise<void>;
  endHold: () => Promise<void>;
  toggleContinuous: () => Promise<void>;
  dispose: () => void;
};

function int16FrameFromSine(phase: { n: number }): ArrayBuffer {
  const samples = new Int16Array(FRAME_SAMPLES);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.floor(Math.sin(phase.n / 12) * 8000);
    phase.n += 1;
  }
  return samples.buffer;
}

export function attachVoiceCapture(
  api: VoiceApi,
  options: {
    micButton: HTMLButtonElement;
    modeButton: HTMLButtonElement;
    liveEl: HTMLElement;
    levelEl: HTMLElement;
  }
): VoiceController {
  let mode: 'hold' | 'continuous' = 'hold';
  let holding = false;
  let fakeTimer: ReturnType<typeof setInterval> | undefined;
  let stream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  let processor: ScriptProcessorNode | undefined;
  let muteGain: GainNode | undefined;
  const phase = { n: 0 };

  const setMicState = (state: string): void => {
    options.micButton.dataset.state = state;
    options.micButton.setAttribute(
      'aria-pressed',
      state === 'holding' || state === 'listening' ? 'true' : 'false'
    );
  };

  const stopGraph = (): void => {
    if (fakeTimer !== undefined) {
      clearInterval(fakeTimer);
      fakeTimer = undefined;
    }
    processor?.disconnect();
    processor = undefined;
    muteGain?.disconnect();
    muteGain = undefined;
    void audioContext?.close();
    audioContext = undefined;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    stream = undefined;
  };

  const pumpFake = (): void => {
    let tick = 0;
    fakeTimer = setInterval(() => {
      tick += 1;
      const silent = mode === 'continuous' && tick % 16 >= 8;
      api.voice.frame(silent ? new Int16Array(FRAME_SAMPLES).buffer : int16FrameFromSine(phase));
    }, 100);
  };

  const pumpMic = async (): Promise<void> => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true },
      video: false
    });
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const sourceRate = audioContext?.sampleRate ?? event.inputBuffer.sampleRate;
      const pcm = resampleToSttPcm(input, sourceRate);
      if (pcm.length === 0) {
        return;
      }
      const copy = new ArrayBuffer(pcm.byteLength);
      new Int16Array(copy).set(pcm);
      api.voice.frame(copy);
    };
    source.connect(processor);
    muteGain = audioContext.createGain();
    muteGain.gain.value = 0;
    processor.connect(muteGain);
    muteGain.connect(audioContext.destination);
  };

  const begin = async (): Promise<boolean> => {
    const result = await api.voice.start(mode);
    if (!result.ok) {
      options.liveEl.hidden = false;
      options.liveEl.textContent = result.error ?? 'dictée indisponible';
      return false;
    }
    options.liveEl.hidden = false;
    options.liveEl.textContent = mode === 'continuous' ? "À l'écoute (VAD)…" : 'Dictée en cours…';
    options.liveEl.dataset.kind = 'voice.partial';
    if (result.fakeCapture) {
      pumpFake();
      return true;
    }
    try {
      await pumpMic();
      return true;
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0 ? error.message : 'micro indisponible';
      options.liveEl.hidden = false;
      options.liveEl.dataset.kind = 'voice.error';
      options.liveEl.textContent = message;
      return false;
    }
  };

  const abort = async (): Promise<void> => {
    stopGraph();
    await api.voice.abort();
  };

  const end = async (): Promise<void> => {
    stopGraph();
    await api.voice.stop();
  };

  api.voice.onPartial((payload) => {
    options.liveEl.hidden = false;
    options.liveEl.dataset.kind = 'voice.partial';
    options.liveEl.textContent = payload.text;
  });

  api.voice.onFinal((payload) => {
    options.liveEl.dataset.kind = 'voice.final';
    options.liveEl.textContent = payload.text;
  });

  api.voice.onLevel((payload) => {
    const bars = options.levelEl.querySelectorAll('i');
    const norm = Math.min(1, payload.rms / 4000);
    bars.forEach((bar, index) => {
      const height = 4 + Math.round(norm * (6 + (index % 3) * 4));
      (bar as HTMLElement).style.height = `${String(height)}px`;
    });
    options.levelEl.dataset.active = payload.rms > 400 ? 'true' : 'false';
  });

  return {
    mode: () => mode,
    setMode: (next) => {
      mode = next;
      options.modeButton.dataset.mode = next;
      options.modeButton.textContent = next === 'hold' ? 'Hold' : 'VAD';
      options.micButton.title = next === 'hold' ? 'Hold to talk' : 'Click for continuous VAD';
      void api.voice.setMode(next);
    },
    setArmed: (armed) => {
      options.micButton.disabled = !armed;
      if (armed) {
        return;
      }
      holding = false;
      setMicState('idle');
      stopGraph();
      void api.voice.abort();
    },
    holding: () => holding,
    startHold: async () => {
      if (holding || options.micButton.disabled) {
        return;
      }
      holding = true;
      setMicState('holding');
      const started = await begin();
      if (!started) {
        holding = false;
        setMicState('idle');
        await abort();
        return;
      }
      if (!holding) {
        await end();
      }
    },
    endHold: async () => {
      if (!holding) {
        return;
      }
      holding = false;
      setMicState('idle');
      await end();
    },
    toggleContinuous: async () => {
      if (mode !== 'continuous' || options.micButton.disabled) {
        return;
      }
      if (holding) {
        holding = false;
        setMicState('idle');
        await end();
        return;
      }
      holding = true;
      setMicState('listening');
      const started = await begin();
      if (!started) {
        holding = false;
        setMicState('idle');
        await abort();
      }
    },
    dispose: () => {
      stopGraph();
    }
  };
}
