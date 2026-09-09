import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SttEngine } from './engine.ts';
import { PARTIAL_WINDOW_MS, STT_SAMPLE_RATE, WHISPER_TIMEOUT_MS_DEFAULT } from './protocol.ts';
import { pcm16ToWav } from './wav.ts';

export type WhisperPaths = {
  bin: string;
  model: string;
};

type Utterance = {
  chunks: Buffer[];
  lastPartialAt: number;
  lastPartial: string;
};

type WhisperJob = {
  utteranceId: string;
  child: ChildProcess;
};

export function whisperCandidateBins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = env.STT_BIN;
  const modelDir = env.STT_MODEL_DIR;
  const resources = env.SPYGLASS_STT_RESOURCES;
  const candidates: string[] = [];
  if (extra !== undefined && extra.length > 0) {
    candidates.push(extra);
  }
  if (resources !== undefined && resources.length > 0) {
    candidates.push(join(resources, 'whisper-cli'), join(resources, 'whisper-cli.exe'));
  }
  if (modelDir !== undefined && modelDir.length > 0) {
    candidates.push(join(modelDir, 'whisper-cli'), join(dirname(modelDir), 'whisper-cli'));
  }
  candidates.push(
    join(process.cwd(), 'vendor/whisper/whisper-cli'),
    join(process.cwd(), 'vendor/whisper/whisper-cli.exe')
  );
  return candidates;
}

export function whisperCandidateModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.STT_MODEL_PATH;
  const dir = env.STT_MODEL_DIR;
  const resources = env.SPYGLASS_STT_RESOURCES;
  const name = env.STT_MODEL ?? 'ggml-small-q5_1.bin';
  const file = name.endsWith('.bin') ? name : `${name}.bin`;
  const candidates: string[] = [];
  if (explicit !== undefined && explicit.length > 0) {
    candidates.push(explicit);
  }
  if (dir !== undefined && dir.length > 0) {
    candidates.push(
      join(dir, file),
      join(dir, 'ggml-small-q5_1.bin'),
      join(dir, 'ggml-large-v3-turbo-q5_0.bin')
    );
  }
  if (resources !== undefined && resources.length > 0) {
    candidates.push(
      join(resources, file),
      join(resources, 'ggml-small-q5_1.bin'),
      join(resources, 'ggml-large-v3-turbo-q5_0.bin')
    );
  }
  candidates.push(
    join(process.cwd(), 'vendor/whisper', file),
    join(process.cwd(), 'vendor/whisper/ggml-small-q5_1.bin'),
    join(process.cwd(), 'vendor/whisper/ggml-large-v3-turbo-q5_0.bin')
  );
  return candidates;
}

export function resolveWhisperPaths(
  env: NodeJS.ProcessEnv = process.env
): WhisperPaths | undefined {
  const bin = whisperCandidateBins(env).find((path) => existsSync(path));
  const model = whisperCandidateModels(env).find((path) => existsSync(path));
  if (bin === undefined || model === undefined) {
    return undefined;
  }
  return { bin, model };
}

export function whisperAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveWhisperPaths(env) !== undefined;
}

function parseWhisperText(stdout: string, txtFile?: string): string {
  const fromFile = txtFile?.trim();
  if (fromFile !== undefined && fromFile.length > 0) {
    return fromFile.replaceAll(/\s+/gu, ' ').trim();
  }
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('whisper_') && !line.startsWith('['));
  const last = lines.at(-1) ?? '';
  if (last.startsWith('[')) {
    const close = last.indexOf(']');
    if (close >= 0) {
      return last.slice(close + 1).trim();
    }
  }
  return last.trim();
}

function readFileHead(path: string, bytes = 80): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function isNodeCliScript(bin: string): boolean {
  const lower = bin.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) {
    return true;
  }
  const line = (readFileHead(bin).split(/\r?\n/u, 1)[0] ?? '').trim();
  return line.startsWith('#!') && /\bnode\b/iu.test(line);
}

function isWindowsBatch(bin: string): boolean {
  const lower = bin.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat');
}

function whisperChildEnv(): NodeJS.ProcessEnv {
  const keys = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'PATHEXT',
    'COMSPEC'
  ] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function spawnWhisperCli(bin: string, args: string[]): ChildProcess {
  const spawnOpts: SpawnOptions = {
    env: whisperChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true
  };
  if (isNodeCliScript(bin)) {
    return spawn(process.execPath, [bin, ...args], spawnOpts);
  }
  if (process.platform === 'win32' && isWindowsBatch(bin)) {
    return spawn(bin, args, { ...spawnOpts, shell: true });
  }
  return spawn(bin, args, spawnOpts);
}

export async function runWhisperCli(options: {
  bin: string;
  model: string;
  wav: Buffer;
  language: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onSpawn?: (child: ChildProcess) => void;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-'));
  const wavPath = join(dir, 'utterance.wav');
  const outBase = join(dir, 'out');
  await writeFile(wavPath, options.wav);
  try {
    if (options.signal?.aborted === true) {
      return '';
    }
    const args = [
      '-m',
      options.model,
      '-f',
      wavPath,
      '-l',
      options.language,
      '-nt',
      '-np',
      '-otxt',
      '-of',
      outBase
    ];
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawnWhisperCli(options.bin, args);
      options.onSpawn?.(child);
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        fn();
      };
      const killChild = (): void => {
        try {
          if (child.pid !== undefined) {
            process.kill(-child.pid, 'SIGKILL');
          }
        } catch {
          child.kill('SIGKILL');
        }
      };
      if (options.signal !== undefined) {
        if (options.signal.aborted) {
          killChild();
          finish(() => {
            resolve('');
          });
          return;
        }
        options.signal.addEventListener('abort', killChild, { once: true });
      }
      const timer = setTimeout(() => {
        killChild();
        finish(() => {
          reject(new Error(`whisper.cpp exceeded ${String(options.timeoutMs)} ms`));
        });
      }, options.timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        finish(() => {
          reject(error);
        });
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (options.signal?.aborted === true) {
          finish(() => {
            resolve('');
          });
          return;
        }
        void readFile(`${outBase}.txt`, 'utf8')
          .then((fileText) => {
            const parsed = parseWhisperText(stdout, fileText);
            if (parsed.length > 0) {
              finish(() => {
                resolve(parsed);
              });
              return;
            }
            const fromStdout = parseWhisperText(stdout);
            if (fromStdout.length > 0) {
              finish(() => {
                resolve(fromStdout);
              });
              return;
            }
            finish(() => {
              reject(
                new Error(
                  stderr.trim().length > 0
                    ? stderr.trim()
                    : `whisper.cpp exited ${String(code ?? 'null')} without text`
                )
              );
            });
          })
          .catch(() => {
            const parsed = parseWhisperText(stdout);
            if (parsed.length > 0) {
              finish(() => {
                resolve(parsed);
              });
              return;
            }
            finish(() => {
              reject(
                new Error(
                  stderr.trim().length > 0
                    ? stderr.trim()
                    : `whisper.cpp exited ${String(code ?? 'null')} without text`
                )
              );
            });
          });
      });
    });
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** L7-108: cap first-use persist retries for the engine lifetime. */
const FIRST_USE_RETRY_LIMIT = 3;

/**
 * L7-008: first-use latency persistence must not fail transcription.
 * L7-043: returns false when the hook fails so firstUseNoted can retry.
 */
export async function notifyFirstUseLatency(
  hook: ((latencyMs: number) => void | Promise<void>) | undefined,
  latencyMs: number
): Promise<boolean> {
  if (hook === undefined) {
    return true;
  }
  try {
    await hook(latencyMs);
    return true;
  } catch {
    return false;
  }
}

/** F8a: AbortError and AbortSignal cancellation are not first-use samples. */
export function isCancelledTranscription(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function createWhisperEngine(options: {
  bin: string;
  model: string;
  language?: string;
  timeoutMs?: number;
  /** F-39: first completed (success or failure) large-model latency. F8a: not abort. */
  onFirstUseLatency?: (latencyMs: number) => void | Promise<void>;
}): SttEngine {
  const language = options.language ?? 'fr';
  const timeoutMs = options.timeoutMs ?? WHISPER_TIMEOUT_MS_DEFAULT;
  const open = new Map<string, Utterance>();
  const controllers = new Map<string, AbortController>();
  const jobs = new Set<WhisperJob>();
  let firstUseNoted = false;
  let firstUsePending: Promise<void> | undefined;
  let firstUseAttempts = 0;
  let firstUseBackoffUntil = 0;

  const killJobs = (utteranceId?: string): void => {
    for (const job of [...jobs]) {
      if (utteranceId !== undefined && job.utteranceId !== utteranceId) {
        continue;
      }
      try {
        if (job.child.pid !== undefined) {
          process.kill(-job.child.pid, 'SIGKILL');
        }
      } catch {
        job.child.kill('SIGKILL');
      }
      jobs.delete(job);
    }
    if (utteranceId !== undefined) {
      controllers.get(utteranceId)?.abort();
      controllers.delete(utteranceId);
      return;
    }
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
  };

  const noteFirstUse = async (latencyMs: number): Promise<void> => {
    const hook = options.onFirstUseLatency;
    if (hook === undefined) {
      return;
    }
    let skipBackoff = false;
    while (!firstUseNoted && firstUseAttempts < FIRST_USE_RETRY_LIMIT) {
      if (firstUsePending !== undefined) {
        await firstUsePending;
        skipBackoff = true;
        continue;
      }
      if (!skipBackoff && Date.now() < firstUseBackoffUntil) {
        return;
      }
      skipBackoff = false;
      // L7-097: persist this call's sample; do not reuse the first latencyMs
      // after joining a failed in-flight hook.
      const pending = (async () => {
        firstUseAttempts += 1;
        const noted = await notifyFirstUseLatency(hook, latencyMs);
        if (noted) {
          firstUseNoted = true;
          return;
        }
        // L7-097: do not back off after the first failed persist so a second
        // finalize can still write its own sample when the two finals did not overlap.
        if (firstUseAttempts >= 2) {
          const delayMs = Math.min(250 * 2 ** (firstUseAttempts - 2), 4_000);
          firstUseBackoffUntil = Date.now() + delayMs;
        }
      })();
      firstUsePending = pending;
      try {
        await pending;
      } finally {
        if (firstUsePending === pending) {
          firstUsePending = undefined;
        }
      }
      break;
    }
  };

  const transcribe = async (utteranceId: string, pcm: Buffer): Promise<string> => {
    if (pcm.length < 3200) {
      return '';
    }
    killJobs(utteranceId);
    const controller = new AbortController();
    controllers.set(utteranceId, controller);
    const wav = pcm16ToWav(pcm, STT_SAMPLE_RATE);
    const started = Date.now();
    try {
      const text = await runWhisperCli({
        bin: options.bin,
        model: options.model,
        wav,
        language,
        timeoutMs,
        signal: controller.signal,
        onSpawn: (child) => {
          const job: WhisperJob = { utteranceId, child };
          jobs.add(job);
          child.on('exit', () => {
            jobs.delete(job);
          });
        }
      });
      if (!controller.signal.aborted) {
        // L7-081: do not block transcribe() on a hanging onFirstUseLatency hook.
        void noteFirstUse(Date.now() - started);
      }
      return text;
    } catch (error) {
      if (!isCancelledTranscription(error, controller.signal)) {
        void noteFirstUse(Date.now() - started);
      }
      throw error;
    } finally {
      controllers.delete(utteranceId);
    }
  };

  return {
    name: 'whisper',
    model: options.model,
    begin(utteranceId: string): void {
      open.set(utteranceId, { chunks: [], lastPartialAt: 0, lastPartial: '' });
    },
    pushPcm(utteranceId: string, pcm: Buffer, onPartial): void {
      const state = open.get(utteranceId);
      if (state === undefined) {
        return;
      }
      state.chunks.push(pcm);
      const now = Date.now();
      if (now - state.lastPartialAt < PARTIAL_WINDOW_MS) {
        return;
      }
      state.lastPartialAt = now;
      const snapshot = Buffer.concat(state.chunks);
      void transcribe(utteranceId, snapshot)
        .then((text) => {
          if (text.length > 0 && text !== state.lastPartial) {
            state.lastPartial = text;
            onPartial(text);
          }
        })
        .catch(() => undefined);
    },
    async finalize(utteranceId: string): Promise<string> {
      const state = open.get(utteranceId);
      open.delete(utteranceId);
      if (state === undefined) {
        killJobs(utteranceId);
        return '';
      }
      const pcm = Buffer.concat(state.chunks);
      try {
        const text = await transcribe(utteranceId, pcm);
        return text.length > 0 ? text : state.lastPartial;
      } catch {
        return state.lastPartial;
      }
    },
    abort(utteranceId: string): void {
      open.delete(utteranceId);
      killJobs(utteranceId);
    },
    dispose(): void {
      open.clear();
      killJobs();
    }
  };
}
