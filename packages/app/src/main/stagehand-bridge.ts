import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StagehandObservation, StagehandObserveResponse } from '../shared/ipc.ts';

export const DEFAULT_OBSERVE_INSTRUCTION = 'Find interactive elements on the displayed page';

export function observeScriptPath(appPath?: string): string | undefined {
  const candidates: string[] = [];
  const resourcesPath = electronResourcesPath();
  if (resourcesPath !== undefined) {
    // Packaged extraResources is a real file; prefer it over asar overlay paths.
    candidates.push(join(resourcesPath, 'scripts/stagehand-observe.mjs'));
    candidates.push(join(resourcesPath, 'stagehand-observe.mjs'));
    candidates.push(join(resourcesPath, 'app.asar.unpacked/scripts/stagehand-observe.mjs'));
  }
  if (appPath !== undefined && appPath.length > 0) {
    candidates.push(join(appPath, 'scripts/stagehand-observe.mjs'));
    const unpacked = unpackedAsarPath(appPath);
    if (unpacked !== undefined) {
      candidates.push(join(unpacked, 'scripts/stagehand-observe.mjs'));
    }
  }
  candidates.push(
    join(import.meta.dirname, '../../scripts/stagehand-observe.mjs'),
    join(import.meta.dirname, '../../../scripts/stagehand-observe.mjs')
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function electronResourcesPath(): string | undefined {
  if (!('resourcesPath' in process)) {
    return undefined;
  }
  const value = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

export function resolveStagehandModule(appPath?: string): string | undefined {
  const pkgCandidates: string[] = [];
  const unpacked = unpackedAsarPath(appPath);
  if (unpacked !== undefined) {
    pkgCandidates.push(join(unpacked, 'node_modules/@browserbasehq/stagehand/package.json'));
  }
  if (appPath !== undefined && appPath.length > 0) {
    pkgCandidates.push(join(appPath, 'package.json'));
  }
  pkgCandidates.push(join(import.meta.dirname, '../../package.json'));
  for (const pkg of pkgCandidates) {
    if (!existsSync(pkg)) {
      continue;
    }
    try {
      const require = createRequire(pkg);
      return pathToFileURL(require.resolve('@browserbasehq/stagehand')).href;
    } catch {
      // try the next package.json
    }
  }
  return undefined;
}

function unpackedAsarPath(appPath?: string): string | undefined {
  if (appPath === undefined || appPath.length === 0) {
    return undefined;
  }
  if (appPath.endsWith('.asar')) {
    return `${appPath}.unpacked`;
  }
  return undefined;
}

export async function runStagehandObserve(options: {
  cdpUrl: string;
  guestUrl: string;
  instruction?: string;
  appPath?: string;
}): Promise<StagehandObserveResponse> {
  return await withObserveMutex(() => spawnStagehandObserve(options));
}

let observeMutex: Promise<void> = Promise.resolve();

/** Serialize Observe so concurrent IPC / observe-on-start cannot share one CDP port. */
export async function withObserveMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = observeMutex;
  let release: () => void = () => {};
  observeMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

async function spawnStagehandObserve(options: {
  cdpUrl: string;
  guestUrl: string;
  instruction?: string;
  appPath?: string;
}): Promise<StagehandObserveResponse> {
  const instruction =
    options.instruction !== undefined && options.instruction.trim().length > 0
      ? options.instruction.trim()
      : DEFAULT_OBSERVE_INSTRUCTION;
  const script = observeScriptPath(options.appPath);
  if (script === undefined) {
    return {
      ok: false,
      instruction,
      observations: [],
      error: 'Stagehand observe script is not available in this build',
      guestUrl: options.guestUrl,
      cdpUrl: options.cdpUrl
    };
  }

  const flags = [
    '--cdp-url',
    options.cdpUrl,
    '--guest-url',
    options.guestUrl,
    '--instruction',
    instruction,
    '--json'
  ];
  const stagehandModule = resolveStagehandModule(options.appPath);
  if (stagehandModule !== undefined) {
    flags.push('--stagehand-module', stagehandModule);
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env
  };
  if (options.appPath !== undefined && options.appPath.length > 0) {
    childEnv.SPYGLASS_APP_PATH = options.appPath;
  }

  childEnv.ELECTRON_RUN_AS_NODE = '1';
  return await runObserveViaSpawn(script, flags, childEnv, {
    instruction,
    guestUrl: options.guestUrl,
    cdpUrl: options.cdpUrl
  });
}

type ObserveContext = {
  instruction: string;
  guestUrl: string;
  cdpUrl: string;
};

async function runObserveViaSpawn(
  script: string,
  flags: string[],
  env: NodeJS.ProcessEnv,
  context: ObserveContext
): Promise<StagehandObserveResponse> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...flags], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    collectObserveChild(child, context, resolve);
  });
}

type ObserveChild = {
  stdout?: { on: (event: 'data', listener: (chunk: string | Uint8Array) => void) => void } | null;
  stderr?: { on: (event: 'data', listener: (chunk: string | Uint8Array) => void) => void } | null;
  on: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => void;
  kill: () => void;
};

function collectObserveChild(
  child: ObserveChild,
  context: ObserveContext,
  resolve: (value: StagehandObserveResponse) => void
): void {
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (value: StagehandObserveResponse): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };
  const timer = setTimeout(() => {
    child.kill();
    finish({
      ok: false,
      instruction: context.instruction,
      observations: [],
      error: 'Stagehand observe timed out',
      guestUrl: context.guestUrl,
      cdpUrl: context.cdpUrl
    });
  }, 90_000);

  child.stdout?.on('data', (chunk: string | Uint8Array) => {
    stdout += chunkToString(chunk);
  });
  child.stderr?.on('data', (chunk: string | Uint8Array) => {
    stderr += chunkToString(chunk);
  });
  child.on('error', (...args: unknown[]) => {
    const error = args[0];
    const message =
      error instanceof Error ? error.message : String(error ?? 'observe worker error');
    finish({
      ok: false,
      instruction: context.instruction,
      observations: [],
      error: message,
      guestUrl: context.guestUrl,
      cdpUrl: context.cdpUrl
    });
  });
  child.on('exit', (...args: unknown[]) => {
    const parsed = parseObserveStdout(stdout);
    if (parsed !== undefined) {
      finish(parsed);
      return;
    }
    const code = args[0];
    finish({
      ok: false,
      instruction: context.instruction,
      observations: [],
      error:
        stderr.trim().length > 0
          ? stderr.trim()
          : `Stagehand observe exited ${String(code ?? 'null')} without JSON`,
      guestUrl: context.guestUrl,
      cdpUrl: context.cdpUrl
    });
  });
}

function chunkToString(chunk: string | Uint8Array): string {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
}

export function parseObserveStdout(stdout: string): StagehandObserveResponse | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const lines = trimmed.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const candidate = line.trim();
    if (!candidate.startsWith('{')) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(candidate);
      const response = asObserveResponse(parsed);
      if (response !== undefined) {
        return response;
      }
    } catch {}
  }
  return undefined;
}

function asObserveResponse(parsed: unknown): StagehandObserveResponse | undefined {
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.ok !== 'boolean') {
    return undefined;
  }
  if (record.observations !== undefined && !Array.isArray(record.observations)) {
    return undefined;
  }
  const observations: StagehandObservation[] = Array.isArray(record.observations)
    ? record.observations.flatMap((item) => {
        const observation = asObservation(item);
        return observation === undefined ? [] : [observation];
      })
    : [];
  const instruction = typeof record.instruction === 'string' ? record.instruction : '';
  const response: StagehandObserveResponse = {
    ok: record.ok,
    instruction,
    observations
  };
  if (typeof record.error === 'string') {
    response.error = record.error;
  }
  if (typeof record.guestUrl === 'string') {
    response.guestUrl = record.guestUrl;
  }
  if (typeof record.cdpUrl === 'string') {
    response.cdpUrl = record.cdpUrl;
  }
  if (typeof record.model === 'string') {
    response.model = record.model;
  }
  return response;
}

function asObservation(item: unknown): StagehandObservation | undefined {
  if (typeof item !== 'object' || item === null) {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const observation: StagehandObservation = {};
  if (typeof record.selector === 'string') {
    observation.selector = record.selector;
  }
  if (typeof record.description === 'string') {
    observation.description = record.description;
  }
  if (typeof record.method === 'string') {
    observation.method = record.method;
  }
  if (
    Array.isArray(record.arguments) &&
    record.arguments.every((value) => typeof value === 'string')
  ) {
    observation.arguments = record.arguments;
  }
  return observation;
}
