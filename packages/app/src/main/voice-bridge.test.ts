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

  it('late startCapture after Stop does not leave capturing true', async () => {
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
        SPYGLASS_STT_IN_PROCESS: '0',
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'late-arm'
      }
    );
    try {
      const started = bridge.startCapture('hold');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await bridge.stopCapture();
      await started.then(
        () => undefined,
        () => undefined
      );
      expect(bridge.isCapturing()).toBe(false);
      bridge.sendFrame(Buffer.alloc(4000, 1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(finals).toEqual([]);
    } finally {
      await bridge.dispose();
    }
  });

  it('startCapture refuses to arm when the session is no longer recording', async () => {
    const finals: string[] = [];
    let recording = true;
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'sealed'
      },
      {
        canCapture: () => recording
      }
    );
    try {
      await bridge.startCapture('hold');
      expect(bridge.isCapturing()).toBe(true);
      recording = false;
      await expect(bridge.startCapture('hold')).rejects.toThrow('voice capture refused');
      expect(bridge.isCapturing()).toBe(false);
      bridge.sendFrame(Buffer.alloc(4000, 1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(finals).toEqual([]);
    } finally {
      await bridge.dispose();
    }
  });

  it('abort during an active flush does not drop the in-flight final', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'keep-flush'
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      const flushing = bridge.stopCapture();
      bridge.abort();
      await flushing;
      expect(finals).toEqual(['keep-flush']);
    } finally {
      await bridge.dispose();
    }
  });

  it('refuses a fresh startCapture during Stop flush while session is still recording', async () => {
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
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'flush-then-refuse'
      },
      {
        canCapture: () => true
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.sendFrame(Buffer.alloc(4000, 1));
      const flushing = bridge.stopCapture();
      bridge.beginStop();
      await expect(bridge.startCapture('hold')).rejects.toThrow('voice capture refused');
      expect(bridge.isCapturing()).toBe(false);
      await flushing;
      expect(finals).toEqual(['flush-then-refuse']);
      await expect(bridge.startCapture('hold')).rejects.toThrow('voice capture refused');
      bridge.resumeCapture();
      await bridge.startCapture('hold');
      expect(bridge.isCapturing()).toBe(true);
    } finally {
      await bridge.dispose();
    }
  });

  it('stop-failure rollback clears the stopping latch so capture can arm again', async () => {
    const bridge = new VoiceBridge(
      {
        onPartial: () => undefined,
        onFinal: () => undefined,
        onLevel: () => undefined,
        onError: (message) => {
          throw new Error(message);
        }
      },
      {
        SPYGLASS_STT_ENGINE: 'mock',
        SPYGLASS_STT_IN_PROCESS: '1',
        SPYGLASS_STT_MOCK_TRANSCRIPTS: 'after-rollback'
      },
      {
        canCapture: () => true
      }
    );
    try {
      await bridge.startCapture('hold');
      bridge.beginStop();
      await expect(bridge.startCapture('hold')).rejects.toThrow('voice capture refused');
      expect(bridge.isCapturing()).toBe(false);
      bridge.resumeCapture();
      await bridge.startCapture('hold');
      expect(bridge.isCapturing()).toBe(true);
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
