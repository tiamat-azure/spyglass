import { describe, expect, it } from 'vitest';
import { attachVoiceCapture } from './voice-capture.ts';

function mockButton(disabled = true): HTMLButtonElement {
  const attrs: Record<string, string> = {};
  return {
    disabled,
    title: '',
    textContent: '',
    dataset: {} as DOMStringMap,
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    getAttribute(name: string) {
      return attrs[name] ?? null;
    }
  } as unknown as HTMLButtonElement;
}

function mockLive(): HTMLElement {
  return {
    hidden: true,
    textContent: '',
    dataset: {} as DOMStringMap
  } as unknown as HTMLElement;
}

function mockLevel(): HTMLElement {
  return {
    dataset: {} as DOMStringMap,
    querySelectorAll: () => []
  } as unknown as HTMLElement;
}

function fakeStream(): { stream: MediaStream; stopped: { n: number } } {
  const stopped = { n: 0 };
  const stream = {
    getTracks: () => [
      {
        stop: () => {
          stopped.n += 1;
        }
      }
    ]
  } as unknown as MediaStream;
  return { stream, stopped };
}

describe('attachVoiceCapture', () => {
  it('tears down a late MediaStream when Stop disarms mid-getUserMedia', async () => {
    const { stream, stopped } = fakeStream();
    let releaseMedia: ((media: MediaStream) => void) | undefined;
    const voice = attachVoiceCapture(
      {
        voice: {
          start: async () => ({ ok: true, fakeCapture: false }),
          stop: async () => ({ ok: true }),
          abort: async () => ({ ok: true }),
          setMode: async () => ({ ok: true }),
          frame: () => undefined,
          onPartial: () => () => undefined,
          onFinal: () => () => undefined,
          onLevel: () => () => undefined
        }
      },
      {
        micButton: mockButton(),
        modeButton: mockButton(false),
        liveEl: mockLive(),
        levelEl: mockLevel(),
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            releaseMedia = resolve;
          })
      }
    );
    voice.setArmed(true);
    const hold = voice.startHold();
    await expect.poll(() => releaseMedia).toBeDefined();
    voice.setArmed(false);
    releaseMedia?.(stream);
    await hold;
    expect(stopped.n).toBeGreaterThan(0);
    expect(voice.holding()).toBe(false);
  });

  it('does not start the mic if Stop races during voice.start', async () => {
    let resolveStart: ((value: { ok: boolean; fakeCapture: boolean }) => void) | undefined;
    let mediaCalls = 0;
    const voice = attachVoiceCapture(
      {
        voice: {
          start: () =>
            new Promise((resolve) => {
              resolveStart = resolve;
            }),
          stop: async () => ({ ok: true }),
          abort: async () => ({ ok: true }),
          setMode: async () => ({ ok: true }),
          frame: () => undefined,
          onPartial: () => () => undefined,
          onFinal: () => () => undefined,
          onLevel: () => () => undefined
        }
      },
      {
        micButton: mockButton(),
        modeButton: mockButton(false),
        liveEl: mockLive(),
        levelEl: mockLevel(),
        getUserMedia: async () => {
          mediaCalls += 1;
          return fakeStream().stream;
        }
      }
    );
    voice.setArmed(true);
    const hold = voice.startHold();
    await expect.poll(() => resolveStart).toBeDefined();
    voice.setArmed(false);
    resolveStart?.({ ok: true, fakeCapture: false });
    await hold;
    expect(mediaCalls).toBe(0);
    expect(voice.holding()).toBe(false);
  });

  it('setArmed(false) stops the graph immediately without aborting STT flush', async () => {
    const mic = mockButton();
    let aborts = 0;
    let frames = 0;
    const voice = attachVoiceCapture(
      {
        voice: {
          start: async () => ({ ok: true, fakeCapture: true }),
          stop: async () => ({ ok: true }),
          abort: async () => {
            aborts += 1;
            return { ok: true };
          },
          setMode: async () => ({ ok: true }),
          frame: () => {
            frames += 1;
          },
          onPartial: () => () => undefined,
          onFinal: () => () => undefined,
          onLevel: () => () => undefined
        }
      },
      {
        micButton: mic,
        modeButton: mockButton(false),
        liveEl: mockLive(),
        levelEl: mockLevel()
      }
    );
    voice.setArmed(true);
    await voice.startHold();
    await expect.poll(() => frames).toBeGreaterThan(0);
    voice.setArmed(false);
    const framesAtDisarm = frames;
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(frames).toBe(framesAtDisarm);
    expect(aborts).toBe(0);
    expect(voice.holding()).toBe(false);
    expect(mic.disabled).toBe(true);
    expect(mic.getAttribute('aria-pressed')).toBe('false');
  });
});
