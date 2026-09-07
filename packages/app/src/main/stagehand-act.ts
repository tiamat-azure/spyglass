import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { observeScriptPath, resolveStagehandModule, withObserveMutex } from './stagehand-bridge.ts';

export type StagehandActRequest = {
  actions: Array<{
    selector: string;
    description: string;
    method: string;
    arguments?: string[];
  }>;
};

export type StagehandActResult = {
  ok: boolean;
  llmCalls: number;
  results: Array<{ selector: string; method: string; success: boolean; message: string }>;
  error?: string;
  guestUrl?: string;
  cdpUrl?: string;
};

export function actScriptPath(appPath?: string): string | undefined {
  const observe = observeScriptPath(appPath);
  const candidates: string[] = [];
  if (observe !== undefined) {
    candidates.push(observe.replace(/stagehand-observe\.mjs$/, 'stagehand-act.mjs'));
  }
  candidates.push(
    join(import.meta.dirname, '../../scripts/stagehand-act.mjs'),
    join(import.meta.dirname, '../../../scripts/stagehand-act.mjs')
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function runStagehandAct(options: {
  cdpUrl: string;
  guestUrl: string;
  actions: StagehandActRequest['actions'];
  appPath?: string;
  chromeTargetId?: string;
}): Promise<StagehandActResult> {
  return await withObserveMutex(() => spawnStagehandAct(options));
}

async function spawnStagehandAct(options: {
  cdpUrl: string;
  guestUrl: string;
  actions: StagehandActRequest['actions'];
  appPath?: string;
  chromeTargetId?: string;
}): Promise<StagehandActResult> {
  const script = actScriptPath(options.appPath);
  if (script === undefined) {
    return {
      ok: false,
      llmCalls: 0,
      results: [],
      error: 'Stagehand act script is not available in this build',
      guestUrl: options.guestUrl,
      cdpUrl: options.cdpUrl
    };
  }
  const flags = ['--cdp-url', options.cdpUrl, '--guest-url', options.guestUrl, '--json'];
  const stagehandModule = resolveStagehandModule(options.appPath);
  if (stagehandModule !== undefined) {
    flags.push('--stagehand-module', stagehandModule);
  }
  if (options.chromeTargetId !== undefined && options.chromeTargetId.length > 0) {
    flags.push('--chrome-target-id', options.chromeTargetId);
  }
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options.appPath !== undefined && options.appPath.length > 0) {
    childEnv.SPYGLASS_APP_PATH = options.appPath;
  }
  childEnv.ELECTRON_RUN_AS_NODE = '1';
  childEnv.SPYGLASS_ACT_ACTIONS = JSON.stringify(options.actions);
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...flags], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value: StagehandActResult): void => {
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
        llmCalls: 0,
        results: [],
        error: 'Stagehand act timed out',
        guestUrl: options.guestUrl,
        cdpUrl: options.cdpUrl
      });
    }, 120_000);
    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({
        ok: false,
        llmCalls: 0,
        results: [],
        error: error.message,
        guestUrl: options.guestUrl,
        cdpUrl: options.cdpUrl
      });
    });
    child.on('exit', (code) => {
      const parsed = parseActStdout(stdout);
      if (parsed !== undefined) {
        finish(parsed);
        return;
      }
      finish({
        ok: false,
        llmCalls: 0,
        results: [],
        error:
          stderr.trim().length > 0
            ? stderr.trim()
            : `Stagehand act exited ${String(code ?? 'null')} without JSON`,
        guestUrl: options.guestUrl,
        cdpUrl: options.cdpUrl
      });
    });
  });
}

export function parseActStdout(stdout: string): StagehandActResult | undefined {
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
      if (typeof parsed !== 'object' || parsed === null) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.ok !== 'boolean' || typeof record.llmCalls !== 'number') {
        continue;
      }
      const result: StagehandActResult = {
        ok: record.ok,
        llmCalls: record.llmCalls,
        results: Array.isArray(record.results)
          ? record.results.flatMap((item) => {
              if (typeof item !== 'object' || item === null) {
                return [];
              }
              const row = item as Record<string, unknown>;
              if (typeof row.selector !== 'string' || typeof row.success !== 'boolean') {
                return [];
              }
              return [
                {
                  selector: row.selector,
                  method: typeof row.method === 'string' ? row.method : '',
                  success: row.success,
                  message: typeof row.message === 'string' ? row.message : ''
                }
              ];
            })
          : []
      };
      if (typeof record.error === 'string') {
        result.error = record.error;
      }
      if (typeof record.guestUrl === 'string') {
        result.guestUrl = record.guestUrl;
      }
      if (typeof record.cdpUrl === 'string') {
        result.cdpUrl = record.cdpUrl;
      }
      return result;
    } catch {
      // try previous line
    }
  }
  return undefined;
}

/** Keep createRequire reachable for packaged act workers that resolve Stagehand. */
export function stagehandRequireHint(appPath?: string): string | undefined {
  if (appPath === undefined) {
    return undefined;
  }
  try {
    const require = createRequire(join(appPath, 'package.json'));
    return pathToFileURL(require.resolve('@browserbasehq/stagehand')).href;
  } catch {
    return undefined;
  }
}
