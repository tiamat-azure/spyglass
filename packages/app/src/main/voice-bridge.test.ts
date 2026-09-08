import { describe, expect, it } from 'vitest';
import { VoiceBridge } from './voice-bridge.ts';

describe('VoiceBridge', () => {
  it('relays PCM through the in-process mock engine and returns a final', async () => {
    const partials: string[] = [];
    const finals: string[] = [];
    const bridge = new VoiceBridge(
      {
        onPartial: (payload) => {
          partials.push(payload.text);
        },
        onFinal: (payload) => {
          finals.push(payload.text);
        },
        onLevel: () => undefined,
        onError: (message) => {
          throw new Error(message);
        }
      },
      {
        SPYGLASS_STT_ENGINE: 'mock',
        SPYGLASS_STT_IN_PROCESS: '1',
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'hors ligne'
      }
    );
    try {
      const status = await bridge.ensureStarted();
      expect(status.engine).toBe('mock');
      bridge.beginUtterance('u1', 1);
      bridge.sendFrame(Buffer.alloc(4000, 1));
      bridge.endUtterance(2);
      await expect.poll(() => finals.at(0)).toBe('hors ligne');
    } finally {
      await bridge.dispose();
    }
  });

  it('continuous energy VAD starts and ends utterances from RMS', async () => {
    const finals: string[] = [];
    const bridge = new VoiceBridge(
      {
        onPartial: () => undefined,
        onFinal: (payload) => {
          finals.push(payload.text);
        },
        onLevel: () => undefined,
        onError: (message) => {
          throw new Error(message);
        }
      },
      {
        SPYGLASS_STT_ENGINE: 'mock',
        SPYGLASS_STT_IN_PROCESS: '1',
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'alpha|beta'
      }
    );
    try {
      await bridge.startCapture('continuous');
      const quiet = pcmFilled(0);
      const loud = pcmFilled(4000);
      for (let i = 0; i < 4; i += 1) {
        bridge.sendFrame(quiet);
      }
      expect(finals).toEqual([]);
      for (let i = 0; i < 4; i += 1) {
        bridge.sendFrame(loud);
      }
      for (let i = 0; i < 8; i += 1) {
        bridge.sendFrame(quiet);
      }
      await expect.poll(() => finals.at(0)).toBe('alpha');
      for (let i = 0; i < 4; i += 1) {
        bridge.sendFrame(loud);
      }
      for (let i = 0; i < 8; i += 1) {
        bridge.sendFrame(quiet);
      }
      await expect.poll(() => finals.at(1)).toBe('beta');
      expect(finals).toHaveLength(2);
    } finally {
      await bridge.dispose();
    }
  });
});

function pcmFilled(sample: number, samples = 1600): Buffer {
  const view = new Int16Array(samples);
  view.fill(sample);
  return Buffer.from(view.buffer);
}
