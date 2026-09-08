import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { correlateVoiceSegment } from './correlate.ts';
import { createInProcessStt } from './in-process.ts';
import { STT_PACKAGE, sidecarStatus } from './index.ts';
import { createMockEngine } from './mock-engine.ts';
import { parseAudioRetention, parseClientMessage, parseMockTranscripts } from './protocol.ts';
import { resolveSttEngineName } from './resolve-engine.ts';
import { startSidecarServer } from './sidecar.ts';
import { createVadState, frameDurationMs, gateVadUtterance, pcmRms, pushVad } from './vad.ts';
import { pcm16ToWav } from './wav.ts';
import { createWhisperEngine, runWhisperCli, whisperAvailable } from './whisper-engine.ts';

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
    const bin = join(dir, 'whisper-cli');
    const model = join(dir, 'ggml-small-q5_1.bin');
    await writeFile(model, 'fake-weights');
    await writeFile(
      bin,
      `#!/bin/sh
set -eu
out=""
wav=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -of) out="$2"; shift 2 ;;
    -f) wav="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "whisper stub ran on $wav" >&2
printf 'transcription locale\\n' > "\${out}.txt"
`
    );
    await chmod(bin, 0o755);
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

  it('rejects invalid client frames', () => {
    expect(parseClientMessage({ type: 'start' })).toBeUndefined();
    expect(parseClientMessage({ type: 'hello', sampleRate: 16000 })?.type).toBe('hello');
  });
});
