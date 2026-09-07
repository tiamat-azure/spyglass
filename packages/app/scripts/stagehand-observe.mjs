#!/usr/bin/env node
/**
 * Lot 0 Stagehand observe proof.
 *
 * Connects in LOCAL mode to the displayed WebContentsView via CDP.
 * Does not launch Chromium and does not use Browserbase.
 *
 * Usage:
 *   1. Start Spyglass with CDP on (`pnpm dev`, or `SPYGLASS_CDP=1` for packaged)
 *   2. Navigate the embedded view
 *   3. pnpm observe
 *      or: node packages/app/scripts/stagehand-observe.mjs --cdp-url http://127.0.0.1:PORT
 *
 * LLM: set OPENAI_API_KEY or ANTHROPIC_API_KEY for a live model.
 * Without a key, a local stub LLM still exercises Stagehand.observe() over CDP.
 *
 * Packaged in-app Observe resolves Stagehand via --stagehand-module / SPYGLASS_APP_PATH.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pageMatchesPickedGuest, pickGuestTarget } from './cdp-guest.mjs';

const DEFAULT_INSTRUCTION = 'Find interactive elements on the displayed page';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function resolveStagehandSpecifier() {
  const fromArg = argValue('--stagehand-module');
  if (fromArg !== undefined && fromArg.length > 0) {
    return fromArg;
  }
  const appPath = process.env.SPYGLASS_APP_PATH;
  if (appPath !== undefined && appPath.length > 0) {
    try {
      const require = createRequire(join(appPath, 'package.json'));
      return pathToFileURL(require.resolve('@browserbasehq/stagehand')).href;
    } catch {
      // fall through to the bare specifier (source checkout)
    }
  }
  return '@browserbasehq/stagehand';
}

async function importStagehand() {
  return await import(resolveStagehandSpecifier());
}

function messageText(message) {
  if (message === undefined || message === null) {
    return '';
  }
  if (typeof message === 'string') {
    return message;
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

class Lot0StubLlmClient {
  constructor() {
    this.type = 'openai';
    this.modelName = 'spyglass-lot0-stub';
    this.hasVision = false;
    this.clientOptions = {};
  }

  async createChatCompletion(payload) {
    const responseModel = payload?.options?.response_model;
    const messages = payload?.options?.messages ?? [];
    const last = messages.at(-1);
    const content = messageText(last);
    const ids = [...content.matchAll(/\[(\d+-\d+)\]/g)].map((match) => match[1]);
    const unique = [...new Set(ids)].slice(0, 8);
    const elements =
      unique.length > 0
        ? unique.map((id) => ({
            elementId: String(id),
            description: `Interactive element ${id} (Lot 0 stub observe)`,
            method: 'click',
            arguments: []
          }))
        : [
            {
              elementId: '0-1',
              description: 'Primary interactive element (Lot 0 stub observe)',
              method: 'click',
              arguments: []
            }
          ];
    const data = { elements };
    if (responseModel !== undefined) {
      return {
        data,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      };
    }
    return {
      id: 'lot0-stub',
      object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(data) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    };
  }
}

async function listTargets(cdpHttpUrl) {
  const response = await fetch(`${cdpHttpUrl.replace(/\/$/, '')}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP list failed: ${String(response.status)}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload;
}

async function readCdpInfo() {
  const candidates = [];
  if (process.env.SPYGLASS_CDP_INFO) {
    candidates.push(process.env.SPYGLASS_CDP_INFO);
  }
  candidates.push(join(homedir(), '.config', 'Spyglass', 'cdp.json'));
  candidates.push(join(homedir(), 'Library', 'Application Support', 'Spyglass', 'cdp.json'));
  candidates.push(join(homedir(), 'AppData', 'Roaming', 'Spyglass', 'cdp.json'));
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      return JSON.parse(raw);
    } catch {}
  }
  return undefined;
}

async function resolveBrowserWebSocket(cdpHttpUrl) {
  const response = await fetch(`${cdpHttpUrl.replace(/\/$/, '')}/json/version`);
  if (!response.ok) {
    throw new Error(`CDP version failed: ${String(response.status)}`);
  }
  const payload = await response.json();
  const ws = payload?.webSocketDebuggerUrl;
  if (typeof ws !== 'string' || ws.length === 0) {
    throw new Error('CDP /json/version did not include webSocketDebuggerUrl');
  }
  return ws;
}

function toHttpCdpUrl(cdpUrl) {
  if (cdpUrl.startsWith('ws://')) {
    return cdpUrl.replace(/^ws:\/\//, 'http://').replace(/\/devtools\/browser\/.*$/, '');
  }
  if (cdpUrl.startsWith('wss://')) {
    return cdpUrl.replace(/^wss:\/\//, 'https://').replace(/\/devtools\/browser\/.*$/, '');
  }
  return cdpUrl;
}

function liveModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { model: 'anthropic/claude-haiku-4-5', source: 'anthropic' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { model: 'openai/gpt-4o-mini', source: 'openai' };
  }
  return undefined;
}

async function main() {
  const jsonMode = hasFlag('--json');
  const info = await readCdpInfo();
  const cdpUrl = argValue('--cdp-url') ?? process.env.SPYGLASS_CDP_URL ?? info?.cdpUrl;
  const guestUrl = argValue('--guest-url') ?? process.env.SPYGLASS_GUEST_URL ?? info?.guestUrl;
  const instruction =
    argValue('--instruction') ?? process.env.SPYGLASS_OBSERVE_INSTRUCTION ?? DEFAULT_INSTRUCTION;

  if (cdpUrl === undefined || cdpUrl.length === 0) {
    const failure = {
      ok: false,
      instruction,
      observations: [],
      error: 'No CDP URL. Start Spyglass, then pass --cdp-url or read userData/cdp.json.'
    };
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(failure)}\n`);
    } else {
      console.error(failure.error);
    }
    process.exitCode = 1;
    return;
  }

  const cdpHttpUrl = toHttpCdpUrl(cdpUrl);
  const targets = await listTargets(cdpHttpUrl);
  const guest = pickGuestTarget(targets, guestUrl);
  if (guest === undefined) {
    const failure = {
      ok: false,
      instruction,
      observations: [],
      error: 'No guest CDP target (WebContentsView) found',
      cdpUrl,
      targets: targets.map((target) => ({ id: target.id, type: target.type, url: target.url }))
    };
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
    return;
  }

  const { Stagehand } = await importStagehand();
  const live = liveModel();
  const stub = new Lot0StubLlmClient();
  const browserWs = cdpUrl.startsWith('ws') ? cdpUrl : await resolveBrowserWebSocket(cdpHttpUrl);
  const options = {
    env: 'LOCAL',
    verbose: 0,
    disablePino: true,
    keepAlive: true,
    model: live?.model ?? 'openai/gpt-4.1-mini',
    localBrowserLaunchOptions: {
      cdpUrl: browserWs,
      preserveUserDataDir: true
    }
  };
  if (live === undefined) {
    options.llmClient = stub;
  }

  const stagehand = new Stagehand(options);
  try {
    await stagehand.init();
    const pages =
      stagehand.context && typeof stagehand.context.pages === 'function'
        ? stagehand.context.pages()
        : [];
    const match = pages.find((page) => {
      const url = typeof page.url === 'function' ? page.url() : '';
      return pageMatchesPickedGuest(url, guest.url);
    });
    if (match === undefined) {
      const failure = {
        ok: false,
        instruction,
        observations: [],
        error:
          'No Stagehand page matched the picked guest (exact or origin+pathname). Refusing to observe an unmatched page.',
        guestUrl: guest.url,
        cdpUrl,
        targetId: guest.id
      };
      process.stdout.write(`${JSON.stringify(failure)}\n`);
      process.exitCode = 1;
      return;
    }
    if (stagehand.context?.setActivePage) {
      stagehand.context.setActivePage(match);
    }

    const raw = await stagehand.observe(instruction, { page: match });
    const observations = Array.isArray(raw)
      ? raw.map((item) => ({
          selector: item?.selector,
          description: item?.description,
          method: item?.method,
          arguments: item?.arguments
        }))
      : [];

    const result = {
      ok: true,
      instruction,
      observations,
      guestUrl: guest.url,
      cdpUrl,
      targetId: guest.id,
      model: live?.source ?? 'spyglass-lot0-stub'
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const result = {
      ok: false,
      instruction,
      observations: [],
      guestUrl: guest.url,
      cdpUrl,
      targetId: guest.id,
      error: error instanceof Error ? error.message : String(error)
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  } finally {
    try {
      await stagehand.close({ force: false });
    } catch {
      // Connecting over CDP must not close Electron.
    }
  }
}

await main();
