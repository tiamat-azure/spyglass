import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correlateVoiceSegment } from './correlate.ts';
import type { SttEngine } from './engine.ts';
import { createInProcessStt } from './in-process.ts';
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
  mockEngineAllowed,
  resolveSttEngineName,
  SttEngineUnavailableError,
  sttEngineUnavailableReason
} from './resolve-engine.ts';
import { startSidecarServer } from './sidecar.ts';
import { createVadState, frameDurationMs, gateVadUtterance, pcmRms, pushVad } from './vad.ts';
import { pcm16ToWav } from './wav.ts';
import { createWhisperEngine, runWhisperCli, whisperAvailable } from './whisper-engine.ts';
import { isLoopbackWsHost } from './ws-localhost.ts';

/**
 * Engine resolution also probes `process.cwd()/vendor/whisper`, which exists on
 * a developer machine that ran `scripts/fetch-whisper.mjs`. Point the cwd at an
 * empty directory so these assertions do not depend on the host.
 */
function noWhisperEnv(): NodeJS.ProcessEnv {
  vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());
  return { STT_BIN: '/nope', STT_MODEL_PATH: '/nope.bin' };
}

describe('@spyglass/stt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports a ready sidecar (no longer a scaffold)', () => {
    expect(STT_PACKAGE).toBe('@spyglass/stt');
    expect(sidecarStatus()).toBe('ready');
  });

  it('defaults AUDIO_RETENTION to none and parses mock transcripts', () => {
    expect(parseAudioRetention(undefined)).toBe('none');
    expect(parseAudioRetention('all')).toBe('all');
    expect(parseMockTranscripts('alpha|beta')).toEqual(['alpha', 'beta']);
  });

  it('only selects the mock engine when asked for it or under a test runner', () => {
    const missing = noWhisperEnv();
    expect(whisperAvailable(missing)).toBe(false);
    expect(resolveSttEngineName({ ...missing, SPYGLASS_STT_ENGINE: 'mock' })).toBe('mock');
    expect(resolveSttEngineName({ ...missing, CI: 'true' })).toBe('mock');
    // A real session must never silently get canned transcripts.
    expect(resolveSttEngineName(missing)).toBe('whisper');
    expect(mockEngineAllowed(missing)).toBe(false);
  });

  it('fails loudly instead of faking a transcription when whisper is missing', () => {
    const missing = noWhisperEnv();
    expect(sttEngineUnavailableReason(missing)).toContain('fetch-whisper');
    expect(sttEngineUnavailableReason({ ...missing, SPYGLASS_STT_ENGINE: 'mock' })).toBeUndefined();
    expect(() => createEngineFromEnv(missing)).toThrow(SttEngineUnavailableError);
    expect(createEngineFromEnv({ ...missing, SPYGLASS_STT_ENGINE: 'mock' }).name).toBe('mock');
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

  it('in-process session streams a final without opening a socket', async () => {
    const session = createInProcessStt(
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
    const session = createInProcessStt({ SPYGLASS_STT_ENGINE: 'mock' }, engine);
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
    const session = createInProcessStt({ SPYGLASS_STT_ENGINE: 'mock' }, engine);
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
