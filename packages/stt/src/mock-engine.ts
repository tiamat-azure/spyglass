import type { SttEngine } from './engine.ts';
import { DEFAULT_MOCK_TRANSCRIPTS, PARTIAL_WINDOW_MS } from './protocol.ts';

type Utterance = {
  bytes: number;
  lastPartialAt: number;
};

export function createMockEngine(transcripts: string[] = [...DEFAULT_MOCK_TRANSCRIPTS]): SttEngine {
  const phrases = transcripts.length > 0 ? transcripts : [...DEFAULT_MOCK_TRANSCRIPTS];
  let cursor = 0;
  const open = new Map<string, Utterance>();
  const assigned = new Map<string, string>();

  const nextPhrase = (): string => {
    const phrase = phrases[cursor % phrases.length] ?? DEFAULT_MOCK_TRANSCRIPTS[0];
    cursor += 1;
    return phrase;
  };

  return {
    name: 'mock',
    model: 'mock-offline',
    begin(utteranceId: string): void {
      open.set(utteranceId, { bytes: 0, lastPartialAt: 0 });
    },
    pushPcm(utteranceId: string, pcm: Buffer, onPartial): void {
      const state = open.get(utteranceId);
      if (state === undefined) {
        return;
      }
      if (!assigned.has(utteranceId)) {
        assigned.set(utteranceId, nextPhrase());
      }
      const phrase = assigned.get(utteranceId);
      if (phrase === undefined) {
        return;
      }
      state.bytes += pcm.length;
      const now = Date.now();
      if (now - state.lastPartialAt < PARTIAL_WINDOW_MS && state.bytes < 3200) {
        return;
      }
      state.lastPartialAt = now;
      const words = phrase.split(/\s+/u).filter((word) => word.length > 0);
      const shown = Math.max(1, Math.min(words.length, Math.floor(state.bytes / 1600) + 1));
      onPartial(words.slice(0, shown).join(' '));
    },
    finalize(utteranceId: string): Promise<string> {
      const state = open.get(utteranceId);
      const phrase = assigned.get(utteranceId);
      open.delete(utteranceId);
      assigned.delete(utteranceId);
      if (state === undefined || state.bytes === 0 || phrase === undefined) {
        return Promise.resolve('');
      }
      return Promise.resolve(phrase);
    },
    abort(utteranceId: string): void {
      open.delete(utteranceId);
      assigned.delete(utteranceId);
    }
  };
}
