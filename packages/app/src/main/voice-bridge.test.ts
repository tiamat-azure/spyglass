import { describe, expect, it } from 'vitest';
import { VoiceBridge } from './voice-bridge.ts';

describe('VoiceBridge', () => {
  it('relays PCM over a localhost sidecar WebSocket and returns a mock final', async () => {
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
      bridge.endUtterance('u1', 2);
      await expect.poll(() => finals.at(0)).toBe('hors ligne');
    } finally {
      await bridge.dispose();
    }
  });
});
