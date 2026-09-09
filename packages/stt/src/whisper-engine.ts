import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { SttEngine } from './engine.ts';
import { PARTIAL_WINDOW_MS, STT_SAMPLE_RATE, WHISPER_TIMEOUT_MS_DEFAULT } from './protocol.ts';
import {
  largeFallbackMarkerDirs,
  readLargeFallbackSync,
  STT_LARGE_MODEL_FILE,
  STT_SMALL_MODEL_FILE
} from './upgrade.ts';
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

/** Basename from STT_MODEL_FILE / STT_MODEL. Large names are skipped in pick (L7-217). */
function configuredSttModelFile(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.STT_MODEL_FILE ?? env.STT_MODEL;
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const name = raw.trim();
  return name.endsWith('.bin') ? name : `${name}.bin`;
}

export function whisperCandidateModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.STT_MODEL_PATH;
  const dir = env.STT_MODEL_DIR;
  const resources = env.SPYGLASS_STT_RESOURCES;
  const file = configuredSttModelFile(env) ?? STT_SMALL_MODEL_FILE;
  const candidates: string[] = [];
  if (explicit !== undefined && explicit.length > 0) {
    candidates.push(explicit);
  }
  if (dir !== undefined && dir.length > 0) {
    candidates.push(
      join(dir, file),
      join(dir, STT_LARGE_MODEL_FILE),
      join(dir, STT_SMALL_MODEL_FILE)
    );
  }
  if (resources !== undefined && resources.length > 0) {
    candidates.push(
      join(resources, file),
      join(resources, STT_LARGE_MODEL_FILE),
      join(resources, STT_SMALL_MODEL_FILE)
    );
  }
  candidates.push(
    join(process.cwd(), 'vendor/whisper', file),
    join(process.cwd(), 'vendor/whisper', STT_LARGE_MODEL_FILE),
    join(process.cwd(), 'vendor/whisper', STT_SMALL_MODEL_FILE)
  );
  return candidates;
}

export function resolveWhisperPaths(
  env: NodeJS.ProcessEnv = process.env
): WhisperPaths | undefined {
  const bin = whisperCandidateBins(env).find((path) => existsSync(path));
  const existing = whisperCandidateModels(env).filter((path) => existsSync(path));
  const model = pickPreferredWhisperModel(existing, env);
  if (bin === undefined || model === undefined) {
    return undefined;
  }
  return { bin, model };
}

/**
 * L7-125: when small and large both exist under resources/vendor, prefer large.
 * Explicit STT_MODEL_PATH still wins for custom/small files (M4a / P6a).
 * L7-189: an explicit path to the conventional large file is skipped when
 * permanent fallback is on. M18a: an existing
 * STT_MODEL_FILE / STT_MODEL match is chosen before that large basename
 * search. F23b / F-39: existence-only large preference honours
 * `large-fallback.json` (and `STT_LARGE_FALLBACK=1`) so callers of
 * {@link resolveWhisperPaths} cannot bypass permanent fallback-to-small.
 */
export function pickPreferredWhisperModel(
  existing: string[],
  env: NodeJS.ProcessEnv
): string | undefined {
  if (existing.length === 0) {
    return undefined;
  }
  const skipByPath = new Map<string, boolean>();
  const skipLargePath = (path: string): boolean => {
    const cached = skipByPath.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const skip = preferSmallAfterLargeFallback(path, env);
    skipByPath.set(path, skip);
    return skip;
  };
  const explicit = env.STT_MODEL_PATH;
  if (explicit !== undefined && explicit.length > 0) {
    const hit = existing.find((path) => path === explicit);
    if (hit !== undefined) {
      // L7-189 / F-39 / F23b: explicit large is skipped when permanent fallback is on.
      // Custom non-large STT_MODEL_PATH still wins (M4a / P6a).
      const hitIsLarge = basename(hit) === STT_LARGE_MODEL_FILE;
      if (!hitIsLarge || !skipLargePath(hit)) {
        return hit;
      }
    }
  }
  const configured = configuredSttModelFile(env);
  if (configured !== undefined) {
    const configuredBase = basename(configured);
    const hit = existing.find((path) => path === configured || basename(path) === configuredBase);
    if (hit !== undefined) {
      // L7-217: configured large basename must not bypass F-39 / F23b / F28b.
      const hitIsLarge = basename(hit) === STT_LARGE_MODEL_FILE;
      if (!hitIsLarge || !skipLargePath(hit)) {
        return hit;
      }
    }
  }
  const large = existing.find((path) => basename(path) === STT_LARGE_MODEL_FILE);
  const skipLarge = large !== undefined && skipLargePath(large);
  if (large !== undefined && !skipLarge) {
    return large;
  }
  const small = existing.find((path) => basename(path) === STT_SMALL_MODEL_FILE);
  if (small !== undefined) {
    return small;
  }
  const nonLarge = existing.find((path) => basename(path) !== STT_LARGE_MODEL_FILE);
  // L7-178 / F-39 / F23b: permanent fallback must not land back on large.
  if (skipLarge) {
    return nonLarge;
  }
  return nonLarge ?? existing[0];
}

/** F23b: skip L7-125 large preference when F-39 fallback-to-small is permanent. */
function preferSmallAfterLargeFallback(largePath: string, env: NodeJS.ProcessEnv): boolean {
  if (env.STT_LARGE_FALLBACK === '1') {
    return true;
  }
  for (const dir of largeFallbackMarkerDirs(env, [largePath])) {
    if (readFallbackMarkerForPathPick(dir)) {
      return true;
    }
  }
  return false;
}

/**
 * I26a: path picking treats non-corrupt marker I/O (EACCES/EISDIR/…) as no
 * marker so {@link resolveWhisperPaths} can return undefined/paths instead of
 * throwing. Corrupt JSON still throws; F16b fail-loud on unreadable stays in
 * the engine factory when large is actually selected.
 */
function readFallbackMarkerForPathPick(dir: string): boolean {
  try {
    return readLargeFallbackSync(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('unreadable large-fallback.json')) {
      return false;
    }
    throw error;
  }
}

export function whisperAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  // L7-215: same model pick as resolveWhisperPaths — only-large + prefer-small
  // must not report available. L7-176: a corrupt/unreadable marker still
  // returns true so auto-select stays whisper and the factory fail-louds (F16b).
  if (!whisperCandidateBins(env).some((path) => existsSync(path))) {
    return false;
  }
  const existing = whisperCandidateModels(env).filter((path) => existsSync(path));
  if (existing.length === 0) {
    return false;
  }
  try {
    return pickPreferredWhisperModel(existing, env) !== undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('large-fallback.json')) {
      return true;
    }
    throw error;
  }
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
export const FIRST_USE_RETRY_LIMIT = 3;
/**
 * L7-108: after two failed persists, wait before another attempt.
 * 250ms was shorter than Windows whisper-cli stub spawn, so a sequential
 * third finalize always slipped through (CI: expected 2, received 3).
 */
export const FIRST_USE_BACKOFF_MS = 2_000;
export const FIRST_USE_BACKOFF_MAX_MS = 8_000;

/**
 * L7-008: first-use latency persistence must not fail transcription.
 * L7-043: returns false when the hook fails so firstUseNoted can retry.
 */
export async function notifyFirstUseLatency(
  hook: ((latencyMs: number) => void | Promise<void>) | undefined,
  latencyMs: number,
  warnOnFinalFailure = false
): Promise<boolean> {
  if (hook === undefined) {
    return true;
  }
  try {
    await hook(latencyMs);
    return true;
  } catch (error) {
    // L7-199: one-shot warning on the last failed persist attempt only.
    if (warnOnFinalFailure) {
      console.warn(
        '[spyglass] first-use latency persist failed:',
        error instanceof Error ? error.message : error
      );
    }
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
  let firstUseQueuedSample: number | undefined;
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
    if (firstUseNoted || firstUseAttempts >= FIRST_USE_RETRY_LIMIT) {
      return;
    }
    // L7-127: a hanging persist must not spawn an awaiter per finalize.
    // Keep one queued sample; the in-flight noteFirstUse drains it.
    if (firstUsePending !== undefined) {
      firstUseQueuedSample = latencyMs;
      return;
    }
    let sample = latencyMs;
    let skipBackoff = false;
    while (!firstUseNoted && firstUseAttempts < FIRST_USE_RETRY_LIMIT) {
      if (!skipBackoff && Date.now() < firstUseBackoffUntil) {
        return;
      }
      skipBackoff = false;
      // L7-097: persist this call's sample; do not reuse the first latencyMs
      // after joining a failed in-flight hook.
      const pending = (async () => {
        firstUseAttempts += 1;
        const noted = await notifyFirstUseLatency(
          hook,
          sample,
          firstUseAttempts >= FIRST_USE_RETRY_LIMIT
        );
        if (noted) {
          firstUseNoted = true;
          return;
        }
        // L7-097: do not back off after the first failed persist so a second
        // finalize can still write its own sample when the two finals did not overlap.
        if (firstUseAttempts >= 2) {
          const delayMs = Math.min(
            FIRST_USE_BACKOFF_MS * 2 ** (firstUseAttempts - 2),
            FIRST_USE_BACKOFF_MAX_MS
          );
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
      if (firstUseNoted) {
        firstUseQueuedSample = undefined;
        return;
      }
      if (firstUseQueuedSample === undefined) {
        break;
      }
      sample = firstUseQueuedSample;
      firstUseQueuedSample = undefined;
      skipBackoff = true;
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
    const started = performance.now();
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
        void noteFirstUse(performance.now() - started);
      }
      return text;
    } catch (error) {
      if (!isCancelledTranscription(error, controller.signal)) {
        void noteFirstUse(performance.now() - started);
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
