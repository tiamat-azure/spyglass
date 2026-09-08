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
    frame: (pcm: ArrayBuffer) => void;
    onPartial: (callback: (payload: { text: string }) => void) => () => void;
    onFinal: (callback: (payload: { text: string }) => void) => () => void;
    onLevel: (callback: (payload: { rms: number }) => void) => () => void;
  };
};

export type VoiceController = {
  mode: () => 'hold' | 'continuous';
  setMode: (mode: 'hold' | 'continuous') => void;
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
    fakeTimer = setInterval(() => {
      api.voice.frame(int16FrameFromSine(phase));
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
      const pcm = new Int16Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        const sample = input[index] ?? 0;
        pcm[index] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      }
      api.voice.frame(pcm.buffer);
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
    options.liveEl.textContent = 'Dictée en cours…';
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
    },
    holding: () => holding,
    startHold: async () => {
      if (holding) {
        return;
      }
      holding = true;
      setMicState('holding');
      const started = await begin();
      if (!started) {
        holding = false;
        setMicState('idle');
        await end();
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
      if (mode !== 'continuous') {
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
        await end();
      }
    },
    dispose: () => {
      stopGraph();
    }
  };
}
