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
      const status = await bridge.startCapture('hold');
      expect(status.engine).toBe('mock');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      bridge.stopCapture();
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

  it('does not finalize a hold with no PCM', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'inventé'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.stopCapture();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(finals).toEqual([]);
    } finally {
      await bridge.dispose();
    }
  });

  it('ignores frames after stopCapture disarms', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'alpha'
      }
    );
    try {
      await bridge.startCapture('continuous');
      bridge.stopCapture();
      const loud = pcmFilled(4000);
      for (let i = 0; i < 8; i += 1) {
        bridge.sendFrame(loud);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(finals).toEqual([]);
    } finally {
      await bridge.dispose();
    }
  });

  it('setCaptureMode switches gating without restarting capture', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'switched'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.setCaptureMode('continuous');
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
      await expect.poll(() => finals.at(0)).toBe('switched');
    } finally {
      await bridge.dispose();
    }
  });

  it('stopCapture waits for the in-flight final', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'flush'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      await bridge.stopCapture();
      expect(finals).toEqual(['flush']);
    } finally {
      await bridge.dispose();
    }
  });

  it('stopCapture waits for a slow onFinal journal, not only the sidecar message', async () => {
    const finals: string[] = [];
    let journalDone = false;
    const bridge = new VoiceBridge(
      {
        onPartial: () => undefined,
        onFinal: async (payload) => {
          await new Promise((resolve) => {
            setTimeout(resolve, 80);
          });
          journalDone = true;
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'slow-journal'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      await bridge.stopCapture();
      expect(journalDone).toBe(true);
      expect(finals).toEqual(['slow-journal']);
    } finally {
      await bridge.dispose();
    }
  });

  it('stopCapture disarms capturing before the flush wait completes', async () => {
    const finals: string[] = [];
    const bridge = new VoiceBridge(
      {
        onPartial: () => undefined,
        onFinal: async (payload) => {
          await new Promise((resolve) => {
            setTimeout(resolve, 80);
          });
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'first|extra'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      const flushing = bridge.stopCapture();
      for (let i = 0; i < 8; i += 1) {
        bridge.sendFrame(Buffer.alloc(4000, 2));
      }
      await flushing;
      expect(finals).toEqual(['first']);
    } finally {
      await bridge.dispose();
    }
  });

  it('empty-hold drop aborts in-process engine so the next utterance is clean', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'kept'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(0));
      await bridge.stopCapture();
      expect(finals).toEqual([]);
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      await bridge.stopCapture();
      expect(finals).toEqual(['kept']);
    } finally {
      await bridge.dispose();
    }
  });

  it('WS stopCapture waits for onFinal before resolving the sidecar waiter', async () => {
    const finals: string[] = [];
    let journalDone = false;
    const bridge = new VoiceBridge(
      {
        onPartial: () => undefined,
        onFinal: async (payload) => {
          await new Promise((resolve) => {
            setTimeout(resolve, 80);
          });
          journalDone = true;
          finals.push(payload.text);
        },
        onLevel: () => undefined,
        onError: (message) => {
          throw new Error(message);
        }
      },
      {
        SPYGLASS_STT_ENGINE: 'mock',
        SPYGLASS_STT_IN_PROCESS: '0',
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'ws-flush'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      await bridge.stopCapture();
      expect(journalDone).toBe(true);
      expect(finals).toEqual(['ws-flush']);
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
