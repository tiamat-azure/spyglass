import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { StagehandObserveResponse } from '../shared/ipc.ts';

export const DEFAULT_OBSERVE_INSTRUCTION = 'Find interactive elements on the displayed page';

export function observeScriptPath(): string | undefined {
  const candidates = [
    join(import.meta.dirname, '../../scripts/stagehand-observe.mjs'),
    join(import.meta.dirname, '../../../scripts/stagehand-observe.mjs')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function runStagehandObserve(options: {
  cdpUrl: string;
  guestUrl: string;
  instruction?: string;
}): Promise<StagehandObserveResponse> {
  const instruction =
    options.instruction !== undefined && options.instruction.trim().length > 0
      ? options.instruction.trim()
      : DEFAULT_OBSERVE_INSTRUCTION;
  const script = observeScriptPath();
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

  return await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        script,
        '--cdp-url',
        options.cdpUrl,
        '--guest-url',
        options.guestUrl,
        '--instruction',
        instruction,
        '--json'
      ],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        ok: false,
        instruction,
        observations: [],
        error: 'Stagehand observe timed out',
        guestUrl: options.guestUrl,
        cdpUrl: options.cdpUrl
      });
    }, 90_000);

    child.stdout.on('data', (chunk: string | Uint8Array) => {
      stdout += chunkToString(chunk);
    });
    child.stderr.on('data', (chunk: string | Uint8Array) => {
      stderr += chunkToString(chunk);
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        instruction,
        observations: [],
        error: error.message,
        guestUrl: options.guestUrl,
        cdpUrl: options.cdpUrl
      });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const parsed = parseObserveStdout(stdout);
      if (parsed !== undefined) {
        resolve(parsed);
        return;
      }
      resolve({
        ok: false,
        instruction,
        observations: [],
        error:
          stderr.trim().length > 0
            ? stderr.trim()
            : `Stagehand observe exited ${String(code ?? 'null')} without JSON`,
        guestUrl: options.guestUrl,
        cdpUrl: options.cdpUrl
      });
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
      if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
        continue;
      }
      return parsed as StagehandObserveResponse;
    } catch {}
  }
  return undefined;
}
