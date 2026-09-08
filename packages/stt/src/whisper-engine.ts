import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
    candidates.push(join(dir, file), join(dir, 'ggml-small-q5_1.bin'));
  }
  if (resources !== undefined && resources.length > 0) {
    candidates.push(join(resources, file), join(resources, 'ggml-small-q5_1.bin'));
  }
  candidates.push(
    join(process.cwd(), 'vendor/whisper', file),
    join(process.cwd(), 'vendor/whisper/ggml-small-q5_1.bin')
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
      const child = spawn(options.bin, args, {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });
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

export function createWhisperEngine(options: {
  bin: string;
  model: string;
  language?: string;
  timeoutMs?: number;
}): SttEngine {
  const language = options.language ?? 'fr';
  const timeoutMs = options.timeoutMs ?? WHISPER_TIMEOUT_MS_DEFAULT;
  const open = new Map<string, Utterance>();
  const controllers = new Map<string, AbortController>();
  const jobs = new Set<WhisperJob>();

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

  const transcribe = async (utteranceId: string, pcm: Buffer): Promise<string> => {
    if (pcm.length < 3200) {
      return '';
    }
    killJobs(utteranceId);
    const controller = new AbortController();
    controllers.set(utteranceId, controller);
    const wav = pcm16ToWav(pcm, STT_SAMPLE_RATE);
    try {
      return await runWhisperCli({
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
