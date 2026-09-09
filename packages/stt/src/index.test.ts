import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { correlateVoiceSegment } from './correlate.ts';
import type { SttEngine } from './engine.ts';
import { createInProcessStt, createInProcessSttFromEnv } from './in-process.ts';
import { STT_PACKAGE, sidecarStatus } from './index.ts';
import { createMockEngine } from './mock-engine.ts';
import {
  parseAudioRetention,
  parseClientMessage,
  parseMockTranscripts,
  VOICE_FLUSH_MS,
  WHISPER_TIMEOUT_MS_DEFAULT
} from './protocol.ts';
import {
  createEngineFromEnv,
  createEngineFromEnvAsync,
  resolveSttEngineName
} from './resolve-engine.ts';
import { startSidecarServer } from './sidecar.ts';
import { createVadState, frameDurationMs, gateVadUtterance, pcmRms, pushVad } from './vad.ts';
import { pcm16ToWav } from './wav.ts';
import {
  createWhisperEngine,
  FIRST_USE_BACKOFF_MS,
  isCancelledTranscription,
  pickPreferredWhisperModel,
  resolveWhisperPaths,
  runWhisperCli,
  whisperAvailable
} from './whisper-engine.ts';
import { isLoopbackWsHost } from './ws-localhost.ts';

describe('@spyglass/stt', () => {
  it('exports a ready sidecar (no longer a scaffold)', () => {
    expect(STT_PACKAGE).toBe('@spyglass/stt');
    expect(sidecarStatus()).toBe('ready');
  });

  it('defaults AUDIO_RETENTION to none and parses mock transcripts', () => {
    expect(parseAudioRetention(undefined)).toBe('none');
    expect(parseAudioRetention('all')).toBe('all');
    expect(parseMockTranscripts('alpha|beta')).toEqual(['alpha', 'beta']);
  });

  it('auto-selects mock when whisper binaries are absent', () => {
    expect(resolveSttEngineName({ SPYGLASS_STT_ENGINE: 'mock' })).toBe('mock');
    expect(whisperAvailable({ STT_BIN: '/nope', STT_MODEL_PATH: '/nope.bin' })).toBe(false);
    expect(resolveSttEngineName({ STT_BIN: '/nope', STT_MODEL_PATH: '/nope.bin' })).toBe('mock');
  });

  it('prefers large weights when small and large both exist under STT resources (L7-125)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-l7125-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = join(dir, 'whisper-cli');
    const small = join(dir, 'ggml-small-q5_1.bin');
    const large = join(dir, 'ggml-large-v3-turbo-q5_0.bin');
    await writeFile(bin, 'stub');
    await writeFile(small, 'small-weights');
    await writeFile(large, 'large-weights');
    const paths = resolveWhisperPaths({ SPYGLASS_STT_RESOURCES: dir });
    expect(paths?.bin).toBe(bin);
    expect(paths?.model).toBe(large);
    const explicit = resolveWhisperPaths({
      SPYGLASS_STT_RESOURCES: dir,
      STT_MODEL_PATH: small
    });
    expect(explicit?.model).toBe(small);
  });

  it('keeps STT_MODEL_FILE when that file exists even if large is present (M18a)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-m18a-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = join(dir, 'whisper-cli');
    const small = join(dir, 'ggml-small-q5_1.bin');
    const large = join(dir, 'ggml-large-v3-turbo-q5_0.bin');
    await writeFile(bin, 'stub');
    await writeFile(small, 'small-weights');
    await writeFile(large, 'large-weights');
    const viaFile = resolveWhisperPaths({
      SPYGLASS_STT_RESOURCES: dir,
      STT_MODEL_FILE: 'ggml-small-q5_1.bin'
    });
    expect(viaFile?.model).toBe(small);
    const viaModel = resolveWhisperPaths({
      SPYGLASS_STT_RESOURCES: dir,
      STT_MODEL: 'ggml-small-q5_1.bin'
    });
    expect(viaModel?.model).toBe(small);
    const missing = resolveWhisperPaths({
      SPYGLASS_STT_RESOURCES: dir,
      STT_MODEL_FILE: 'does-not-exist.bin'
    });
    expect(missing?.model).toBe(large);
  });

  it('does not let large basename override an existing STT_MODEL_FILE (M18a)', () => {
    const small = '/res/ggml-small-q5_1.bin';
    const large = '/res/ggml-large-v3-turbo-q5_0.bin';
    expect(
      pickPreferredWhisperModel([small, large], { STT_MODEL_FILE: 'ggml-small-q5_1.bin' })
    ).toBe(small);
    expect(
      pickPreferredWhisperModel([large, small], { STT_MODEL_FILE: 'ggml-small-q5_1.bin' })
    ).toBe(small);
    expect(pickPreferredWhisperModel([small, large], {})).toBe(large);
    expect(
      pickPreferredWhisperModel([small, large], {
        STT_MODEL_PATH: small,
        STT_MODEL_FILE: 'ggml-large-v3-turbo-q5_0.bin'
      })
    ).toBe(small);
  });

  it('correlates dictation before and after a DOM step', () => {
    const before = correlateVoiceSegment(1000, 2000, undefined, 0, 8000);
    expect(before.relation).toBe('before');
    expect(before.correlatedStepIndex).toBe(1);
    const after = correlateVoiceSegment(
      4000,
      5000,
      { eventId: 'evt_000011', stepIndex: 1, ts: 3000 },
      1,
      8000
    );
    expect(after.relation).toBe('after');
    expect(after.correlatedEventId).toBe('evt_000011');
    expect(after.correlatedStepIndex).toBe(1);
  });

  it('C2b: speech that starts before a capture is before, even if it ends after', () => {
    const overlap = correlateVoiceSegment(
      1000,
      4000,
      { eventId: 'evt_000011', stepIndex: 1, ts: 2500 },
      1,
      8000
    );
    expect(overlap.relation).toBe('before');
    expect(overlap.correlatedEventId).toBe('evt_000011');
    expect(overlap.correlatedStepIndex).toBe(1);
  });

  it('C2b: speech that starts after a capture within the margin is after', () => {
    const after = correlateVoiceSegment(
      3100,
      4000,
      { eventId: 'evt_000011', stepIndex: 1, ts: 3000 },
      1,
      8000
    );
    expect(after.relation).toBe('after');
    expect(after.correlatedEventId).toBe('evt_000011');
  });

  it('treats a distant previous action as a new before-next intention', () => {
    const next = correlateVoiceSegment(
      20_000,
      21_000,
      { eventId: 'evt_000002', stepIndex: 2, ts: 1000 },
      2,
      8000
    );
    expect(next.relation).toBe('before');
    expect(next.correlatedStepIndex).toBe(3);
  });

  it('detects speech via energy VAD with hangover', () => {
    const state = createVadState();
    const loud = Int16Array.from({ length: 320 }, () => 4000);
    const quiet = Int16Array.from({ length: 320 }, () => 0);
    const start = pushVad(state, loud, 20);
    expect(start.started).toBe(true);
    expect(pcmRms(loud)).toBeGreaterThan(1000);
    let ended = false;
    for (let i = 0; i < 30; i += 1) {
      const step = pushVad(state, quiet, 20);
      if (step.ended) {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
  });

  it('gates continuous utterances: silence is dropped, speech starts, hangover ends', () => {
    const state = createVadState();
    const loud = Int16Array.from({ length: 1600 }, () => 4000);
    const quiet = Int16Array.from({ length: 1600 }, () => 0);
    const frameMs = frameDurationMs(1600, 16_000);
    expect(gateVadUtterance(state, quiet, frameMs).sendFrame).toBe(false);
    const start = gateVadUtterance(state, loud, frameMs);
    expect(start.startUtterance).toBe(true);
    expect(start.sendFrame).toBe(true);
    expect(gateVadUtterance(state, loud, frameMs).startUtterance).toBe(false);
    let ended = false;
    for (let i = 0; i < 10; i += 1) {
      const step = gateVadUtterance(state, quiet, frameMs);
      if (step.endUtterance) {
        ended = true;
        expect(step.sendFrame).toBe(true);
        break;
      }
    }
    expect(ended).toBe(true);
    expect(gateVadUtterance(state, quiet, frameMs).sendFrame).toBe(false);
  });

  it('writes a valid PCM16 WAV header', () => {
    const wav = pcm16ToWav(Buffer.alloc(3200));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16_000);
  });

  it('mock engine streams partials then a scripted final without network', async () => {
    const engine = createMockEngine(['bonjour le monde']);
    engine.begin('u1');
    const partials: string[] = [];
    engine.pushPcm('u1', Buffer.alloc(4000), (text) => {
      partials.push(text);
    });
    const finalText = await engine.finalize('u1');
    expect(finalText).toBe('bonjour le monde');
    expect(partials[0]?.startsWith('bonjour')).toBe(true);
  });

  it('mock engine does not invent text for a 0-byte utterance', async () => {
    const engine = createMockEngine(['ne pas inventer']);
    engine.begin('empty');
    await expect(engine.finalize('empty')).resolves.toBe('');
  });

  it('accepts only exact loopback Host headers', () => {
    expect(isLoopbackWsHost('127.0.0.1')).toBe(true);
    expect(isLoopbackWsHost('127.0.0.1:9400')).toBe(true);
    expect(isLoopbackWsHost('localhost')).toBe(true);
    expect(isLoopbackWsHost('LOCALHOST:9')).toBe(true);
    expect(isLoopbackWsHost('127.0.0.1.evil.test')).toBe(false);
    expect(isLoopbackWsHost('localhost.evil.test')).toBe(false);
    expect(isLoopbackWsHost('10.0.0.1')).toBe(false);
  });

  it('createInProcessStt is synchronous and is not a Promise (A5b)', () => {
    const session = createInProcessStt(
      { SPYGLASS_STT_ENGINE: 'mock' },
      createMockEngine(['hors ligne'])
    );
    expect(session).not.toBeInstanceOf(Promise);
    expect(typeof session.begin).toBe('function');
    expect(typeof session.dispose).toBe('function');
  });

  it('throws when whisper is required without a provided engine (A5b)', () => {
    expect(() => createInProcessStt({ SPYGLASS_STT_ENGINE: 'whisper' })).toThrow(
      /createInProcessSttFromEnv/
    );
  });

  it('createInProcessSttFromEnv loads a mock engine from env (A5b)', async () => {
    const session = await createInProcessSttFromEnv({
      SPYGLASS_STT_ENGINE: 'mock',
      SPYGLASS_STT_MOCK_TRANSCRIPTS: 'hors ligne'
    });
    expect(session).not.toBeInstanceOf(Promise);
    expect(session.engine).toBe('mock');
    session.begin('u1', 1);
    session.pushPcm(Buffer.alloc(4000, 1), () => undefined);
    const final = await session.end(2);
    expect(final?.text).toBe('hors ligne');
    session.dispose();
  });

  it('createEngineFromEnv is synchronous and is not a Promise (A17b)', () => {
    const engine = createEngineFromEnv({
      SPYGLASS_STT_ENGINE: 'mock',
      SPYGLASS_STT_MOCK_TRANSCRIPTS: 'hors ligne'
    });
    expect(engine).not.toBeInstanceOf(Promise);
    expect(engine.name).toBe('mock');
    expect(engine.model).toBe('mock-offline');
  });

  it('createEngineFromEnvAsync returns a Promise (A17b)', async () => {
    const pending = createEngineFromEnvAsync({ SPYGLASS_STT_ENGINE: 'mock' });
    expect(pending).toBeInstanceOf(Promise);
    const engine = await pending;
    expect(engine.name).toBe('mock');
  });

  it('in-process session streams a final without opening a socket', async () => {
    const session = await createInProcessStt(
      { SPYGLASS_STT_ENGINE: 'mock' },
      createMockEngine(['hors ligne'])
    );
    const partials: string[] = [];
    session.begin('u1', 1);
    session.pushPcm(Buffer.alloc(4000, 1), (text) => {
      partials.push(text);
    });
    const final = await session.end(2);
    expect(final?.text).toBe('hors ligne');
    expect(partials[0]?.startsWith('hors')).toBe(true);
  });

  it('flush wait is at least the whisper timeout', () => {
    expect(WHISPER_TIMEOUT_MS_DEFAULT).toBe(8_000);
    expect(VOICE_FLUSH_MS).toBeGreaterThanOrEqual(WHISPER_TIMEOUT_MS_DEFAULT);
  });

  it('abort after end cancels that utterance’s in-flight finalize, not the whole engine', async () => {
    let disposed = false;
    let finalizeStarted = false;
    const aborted: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: SttEngine = {
      name: 'mock',
      model: 'mock-offline',
      begin: () => undefined,
      pushPcm: () => undefined,
      abort: (id) => {
        aborted.push(id);
      },
      finalize: async () => {
        finalizeStarted = true;
        await gate;
        return 'should-not-require-live';
      },
      dispose: () => {
        disposed = true;
      }
    };
    const session = await createInProcessStt({ SPYGLASS_STT_ENGINE: 'mock' }, engine);
    session.begin('u1', 1);
    session.pushPcm(Buffer.alloc(4000, 1), () => undefined);
    const ending = session.end(2);
    await expect.poll(() => finalizeStarted).toBe(true);
    session.abort();
    expect(aborted).toEqual(['u1']);
    expect(disposed).toBe(false);
    release?.();
    await ending;
  });

  it('abort of a live utterance does not dispose in-flight finalize of a prior one', async () => {
    const aborted: string[] = [];
    let u1FinalizeStarted = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: SttEngine = {
      name: 'mock',
      model: 'mock-offline',
      begin: () => undefined,
      pushPcm: () => undefined,
      abort: (id) => {
        aborted.push(id);
      },
      finalize: async (id) => {
        if (id === 'u1') {
          u1FinalizeStarted = true;
          await gate;
        }
        return id;
      }
    };
    const session = await createInProcessStt({ SPYGLASS_STT_ENGINE: 'mock' }, engine);
    session.begin('u1', 1);
    session.pushPcm(Buffer.alloc(4000, 1), () => undefined);
    const ending = session.end(2);
    await expect.poll(() => u1FinalizeStarted).toBe(true);
    session.begin('u2', 3);
    session.abort();
    expect(aborted).toEqual(['u2']);
    release?.();
    await expect(ending).resolves.toMatchObject({ utteranceId: 'u1', text: 'u1' });
  });

  it('sidecar close disposes the whisper engine', async () => {
    let disposed = false;
    const inner = createMockEngine(['x']);
    const engine: SttEngine = {
      name: inner.name,
      model: inner.model,
      begin: (id) => {
        inner.begin(id);
      },
      pushPcm: (id, pcm, onPartial) => {
        inner.pushPcm(id, pcm, onPartial);
      },
      abort: (id) => {
        inner.abort(id);
      },
      finalize: async (id) => await inner.finalize(id),
      dispose: () => {
        disposed = true;
      }
    };
    const handle = await startSidecarServer({ SPYGLASS_STT_ENGINE: 'mock' }, engine);
    await handle.close();
    expect(disposed).toBe(true);
  });

  it('keeps PCM per utterance when the next start arrives before the prior final', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const inner = createMockEngine(['alpha', 'beta']);
    const delayed = {
      name: inner.name,
      model: inner.model,
      begin: (id: string) => {
        inner.begin(id);
      },
      pushPcm: (id: string, pcm: Buffer, onPartial: (text: string) => void) => {
        inner.pushPcm(id, pcm, onPartial);
      },
      abort: (id: string) => {
        inner.abort(id);
      },
      finalize: async (id: string) => {
        if (id === 'u1') {
          await firstGate;
        }
        return await inner.finalize(id);
      }
    };
    const handle = await startSidecarServer({ SPYGLASS_STT_ENGINE: 'mock' }, delayed);
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${String(handle.port)}`);
      const finals: Array<{ utteranceId: string; text: string }> = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('overlap timeout')), 4000);
        ws.addEventListener('message', (event) => {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          if (!raw.includes('"type":"final"')) {
            return;
          }
          const parsed = JSON.parse(raw) as { utteranceId: string; text: string };
          finals.push({ utteranceId: parsed.utteranceId, text: parsed.text });
          if (finals.length >= 2) {
            clearTimeout(timer);
            resolve();
          }
        });
        ws.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error('ws error'));
        });
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ type: 'hello', sampleRate: 16000 }));
          ws.send(JSON.stringify({ type: 'start', utteranceId: 'u1', startTs: 1 }));
          ws.send(new Int16Array(1600).buffer);
          ws.send(JSON.stringify({ type: 'end', utteranceId: 'u1', endTs: 2 }));
          ws.send(JSON.stringify({ type: 'start', utteranceId: 'u2', startTs: 3 }));
          ws.send(new Int16Array(1600).buffer);
          ws.send(JSON.stringify({ type: 'end', utteranceId: 'u2', endTs: 4 }));
          releaseFirst?.();
        });
      });
      ws.close();
      expect(finals.find((row) => row.utteranceId === 'u1')).toEqual({
        utteranceId: 'u1',
        text: 'alpha'
      });
      expect(finals.find((row) => row.utteranceId === 'u2')).toEqual({
        utteranceId: 'u2',
        text: 'beta'
      });
    } finally {
      await handle.close();
    }
  });

  it('serves streaming transcripts over localhost WebSocket only', async () => {
    const handle = await startSidecarServer(
      { SPYGLASS_STT_ENGINE: 'mock', SPYGLASS_STT_MOCK_TRANSCRIPTS: 'hors ligne' },
      createMockEngine(['hors ligne'])
    );
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${String(handle.port)}`);
      const messages: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sidecar timeout')), 4000);
        ws.addEventListener('message', (event) => {
          messages.push(typeof event.data === 'string' ? event.data : String(event.data));
          if (messages.some((row) => row.includes('"type":"final"'))) {
            clearTimeout(timer);
            resolve();
          }
        });
        ws.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error('ws error'));
        });
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ type: 'hello', sampleRate: 16000 }));
          ws.send(JSON.stringify({ type: 'start', utteranceId: 'u1', startTs: 1 }));
          ws.send(new Int16Array(1600).buffer);
          ws.send(JSON.stringify({ type: 'end', utteranceId: 'u1', endTs: 2 }));
        });
      });
      ws.close();
      expect(messages.some((row) => row.includes('"engine":"mock"'))).toBe(true);
      expect(messages.some((row) => row.includes('hors ligne'))).toBe(true);
      expect(handle.engine).toBe('mock');
    } finally {
      const started = Date.now();
      await handle.close();
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });

  it('whisper engine invokes a local stub binary and never opens a network URL', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-stub-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir);
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    const engine = createWhisperEngine({ bin, model, timeoutMs: 4000 });
    engine.begin('u1');
    engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
    const text = await engine.finalize('u1');
    expect(text).toBe('transcription locale');
    const direct = await runWhisperCli({
      bin,
      model,
      wav: pcm16ToWav(Buffer.alloc(3200, 2)),
      language: 'fr',
      timeoutMs: 4000
    });
    expect(direct).toBe('transcription locale');
  });

  it('abort and dispose kill in-flight whisper-cli children', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-abort-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { hangMs: 30_000 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    const engine = createWhisperEngine({ bin, model, timeoutMs: 40_000 });
    engine.begin('slow');
    const started = Date.now();
    engine.pushPcm('slow', Buffer.alloc(6400, 1), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 80));
    engine.abort('slow');
    engine.dispose?.();
    expect(Date.now() - started).toBeLessThan(3_000);
    const ac = new AbortController();
    const pending = runWhisperCli({
      bin,
      model,
      wav: pcm16ToWav(Buffer.alloc(3200, 2)),
      language: 'fr',
      timeoutMs: 40_000,
      signal: ac.signal
    });
    ac.abort();
    await expect(pending).resolves.toBe('');
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('does not SIGKILL another utterance’s in-flight whisper finalize', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-overlap-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 400 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    const engine = createWhisperEngine({ bin, model, timeoutMs: 8_000 });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const first = engine.finalize('u1');
      engine.begin('u2');
      engine.pushPcm('u2', Buffer.alloc(6400, 2), () => undefined);
      await expect(first).resolves.toBe('transcription locale');
    } finally {
      engine.dispose?.();
    }
  });

  it('runs the first-use latency hook once when two finals overlap (L7-059)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-firstuse-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 150 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: () => {
        calls += 1;
      }
    });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      const first = engine.finalize('u1');
      engine.begin('u2');
      engine.pushPcm('u2', Buffer.alloc(6400, 2), () => undefined);
      const second = engine.finalize('u2');
      await Promise.all([first, second]);
      expect(calls).toBe(1);
    } finally {
      engine.dispose?.();
    }
  });

  it('retries first-use latency with the second call sample when the first hook fails (L7-097)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-l7097-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 80 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => {
            setTimeout(resolve, 40);
          });
          throw new Error('first-use persist failed');
        }
      }
    });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      const first = engine.finalize('u1');
      engine.begin('u2');
      engine.pushPcm('u2', Buffer.alloc(6400, 2), () => undefined);
      const second = engine.finalize('u2');
      await Promise.all([first, second]);
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
      expect(calls).toBe(2);
    } finally {
      engine.dispose?.();
    }
  });

  it('retries first-use latency on a later finalize when the first persist failed without overlap (L7-097)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-l7097-seq-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 20 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('first-use persist failed');
        }
      }
    });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      await engine.finalize('u1');
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      engine.begin('u2');
      engine.pushPcm('u2', Buffer.alloc(6400, 2), () => undefined);
      await engine.finalize('u2');
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(calls).toBe(2);
    } finally {
      engine.dispose?.();
    }
  });

  it('caps first-use latency hook retries when persist keeps failing (L7-108)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-l7108-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 40 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: () => {
        calls += 1;
        throw new Error('persist failed');
      }
    });
    try {
      for (let index = 0; index < 8; index += 1) {
        const id = `u${String(index)}`;
        engine.begin(id);
        engine.pushPcm(id, Buffer.alloc(6400, 1), () => undefined);
        await engine.finalize(id);
      }
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(3);
    } finally {
      engine.dispose?.();
    }
  });

  it('does not persist first-use latency during backoff after the second failed persist (L7-108)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-l7108-backoff-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 20 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: () => {
        calls += 1;
        throw new Error('persist failed');
      }
    });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      await engine.finalize('u1');
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      engine.begin('u2');
      engine.pushPcm('u2', Buffer.alloc(6400, 2), () => undefined);
      await engine.finalize('u2');
      const waited = Date.now();
      while (calls < 2 && Date.now() - waited < 1_000) {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      expect(calls).toBe(2);
      engine.begin('u3');
      engine.pushPcm('u3', Buffer.alloc(6400, 3), () => undefined);
      await engine.finalize('u3');
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      // First isolated failure does not back off (L7-097). The second starts
      // backoff (FIRST_USE_BACKOFF_MS); the third is skipped while that
      // window is open. Do not insert extra delay after the second persist —
      // Windows stub spawn already consumes part of the window.
      expect(calls).toBe(2);
      expect(FIRST_USE_BACKOFF_MS).toBeGreaterThanOrEqual(2_000);
    } finally {
      engine.dispose?.();
    }
  });

  it('does not note first-use latency on abort or cancellation (F8a)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-f8a-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 400 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: () => {
        calls += 1;
      }
    });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 50));
      engine.abort('u1');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(calls).toBe(0);
      engine.begin('u2');
      engine.pushPcm('u2', Buffer.alloc(6400, 2), () => undefined);
      await expect(engine.finalize('u2')).resolves.toBe('transcription locale');
      expect(calls).toBe(1);
    } finally {
      engine.dispose?.();
    }
  });

  it('treats AbortError as cancellation (F8a)', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isCancelledTranscription(abort)).toBe(true);
    const ac = new AbortController();
    ac.abort();
    expect(isCancelledTranscription(new Error('killed'), ac.signal)).toBe(true);
    expect(isCancelledTranscription(new Error('whisper.cpp exceeded 80 ms'))).toBe(false);
  });

  it('does not block transcribe on a hanging first-use latency hook (L7-081)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-hanghook-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 40 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: () => new Promise(() => undefined)
    });
    try {
      engine.begin('u1');
      engine.pushPcm('u1', Buffer.alloc(6400, 1), () => undefined);
      const result = await Promise.race([
        engine.finalize('u1'),
        new Promise<string>((_, reject) => {
          setTimeout(() => {
            reject(new Error('transcribe blocked on onFirstUseLatency'));
          }, 2000);
        })
      ]);
      expect(result).toBe('transcription locale');
    } finally {
      engine.dispose?.();
    }
  });

  it('keeps at most one queued first-use sample while persist hangs (L7-127)', async () => {
    const dir = join(tmpdir(), `spyglass-whisper-l7127-${String(Date.now())}`);
    await mkdir(dir, { recursive: true });
    const bin = await writeWhisperCliStub(dir, { delayMs: 20 });
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    let calls = 0;
    let failFirst: (() => void) | undefined;
    const engine = createWhisperEngine({
      bin,
      model,
      timeoutMs: 8_000,
      onFirstUseLatency: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((_, reject) => {
            failFirst = () => {
              reject(new Error('first-use persist hung then failed'));
            };
          });
        }
      }
    });
    try {
      for (let index = 0; index < 8; index += 1) {
        const id = `u${String(index)}`;
        engine.begin(id);
        engine.pushPcm(id, Buffer.alloc(6400, 1), () => undefined);
        await engine.finalize(id);
      }
      expect(calls).toBe(1);
      expect(failFirst).toBeDefined();
      failFirst?.();
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
      // In-flight hang plus one queued retry — not one hook per finalize.
      expect(calls).toBe(2);
    } finally {
      engine.dispose?.();
    }
  });

  it('rejects invalid client frames', () => {
    expect(parseClientMessage({ type: 'start' })).toBeUndefined();
    expect(parseClientMessage({ type: 'hello', sampleRate: 16000 })?.type).toBe('hello');
  });
});

/** Portable whisper-cli stub: Node CJS, not a shebang `sh` file Windows cannot spawn. */
async function writeWhisperCliStub(
  dir: string,
  options: { delayMs?: number; hangMs?: number } = {}
): Promise<string> {
  const bin = join(dir, 'whisper-cli.cjs');
  const delayMs = options.delayMs ?? 0;
  const hangMs = options.hangMs ?? 0;
  const lines = [
    "'use strict';",
    "const { writeFileSync } = require('node:fs');",
    'const argv = process.argv.slice(2);',
    "let out = '';",
    "let wav = '';",
    'for (let i = 0; i < argv.length; i += 1) {',
    "  if (argv[i] === '-of' && argv[i + 1] !== undefined) {",
    '    out = argv[i + 1];',
    '    i += 1;',
    '    continue;',
    '  }',
    "  if (argv[i] === '-f' && argv[i + 1] !== undefined) {",
    '    wav = argv[i + 1];',
    '    i += 1;',
    '  }',
    '}',
    `const delayMs = ${String(delayMs)};`,
    `const hangMs = ${String(hangMs)};`,
    'const emit = () => {',
    '  if (wav.length > 0) {',
    "    process.stderr.write('whisper stub ran on ' + wav + '\\n');",
    '  }',
    "  const text = 'transcription locale\\n';",
    '  if (out.length > 0) {',
    "    writeFileSync(out + '.txt', text);",
    '  }',
    '  process.stdout.write(text);',
    '};',
    'if (hangMs > 0) {',
    '  setTimeout(() => undefined, hangMs);',
    '} else if (delayMs > 0) {',
    '  setTimeout(emit, delayMs);',
    '} else {',
    '  emit();',
    '}'
  ];
  await writeFile(bin, `${lines.join('\n')}\n`);
  return bin;
}
