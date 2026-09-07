#!/usr/bin/env node

/**
 * Lot 1 Stagehand act() proof (F-22 / I-07).
 *
 * Replays locally built ObserveResult-compatible actions over CDP.
 * selfHeal is off. The stub LLM throws if createChatCompletion is called,
 * so a successful run proves zero LLM usage.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pickGuestTarget, pickStagehandPage } from './cdp-guest.mjs';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
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
      // fall through
    }
  }
  return '@browserbasehq/stagehand';
}

class CountingThrowLlmClient {
  constructor() {
    this.type = 'openai';
    this.modelName = 'spyglass-lot1-no-llm';
    this.hasVision = false;
    this.clientOptions = {};
    this.calls = 0;
  }

  async createChatCompletion() {
    this.calls += 1;
    throw new Error('Lot 1 act() must not call an LLM (F-22)');
  }
}

async function listTargets(cdpHttpUrl) {
  const response = await fetch(`${cdpHttpUrl.replace(/\/$/, '')}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP list failed: ${String(response.status)}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
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

async function readActions() {
  const fromArg = argValue('--actions');
  let raw;
  if (fromArg !== undefined && fromArg.length > 0) {
    raw = existsSync(fromArg) ? await readFile(fromArg, 'utf8') : fromArg;
  } else {
    raw = process.env.SPYGLASS_ACT_ACTIONS ?? '[]';
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('actions must be a JSON array');
  }
  return parsed;
}

function isCheckReplayMethod(method) {
  return method === 'setChecked' || method === 'check' || method === 'uncheck';
}

function desiredCheckedState(method, args) {
  if (method === 'uncheck') {
    return false;
  }
  if (method === 'check' && args.length === 0) {
    return true;
  }
  const raw = args[0];
  if (raw === 'false' || raw === '0') {
    return false;
  }
  return true;
}

async function applySetChecked(page, selector, desired) {
  const locator = page.deepLocator(selector);
  const current = await locator.isChecked();
  if (current === desired) {
    return;
  }
  if (typeof locator.setChecked === 'function') {
    await locator.setChecked(desired);
  } else if (typeof locator.click === 'function') {
    await locator.click();
  } else {
    throw new Error('setChecked is not available; refusing click-toggle (C1b)');
  }
  const after = await locator.isChecked();
  if (after !== desired) {
    throw new Error(`setChecked(${String(desired)}) left checked=${String(after)}`);
  }
}

async function main() {
  const info = await readCdpInfo();
  const cdpUrl = argValue('--cdp-url') ?? process.env.SPYGLASS_CDP_URL ?? info?.cdpUrl;
  const guestUrl = argValue('--guest-url') ?? process.env.SPYGLASS_GUEST_URL ?? info?.guestUrl;
  const stub = new CountingThrowLlmClient();

  const fail = (error) => {
    const failure = {
      ok: false,
      llmCalls: stub.calls,
      results: [],
      error
    };
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  };

  if (cdpUrl === undefined || cdpUrl.length === 0) {
    fail('No CDP URL. Start Spyglass, then pass --cdp-url.');
    return;
  }

  let actions;
  try {
    actions = await readActions();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const cdpHttpUrl = toHttpCdpUrl(cdpUrl);
  const targets = await listTargets(cdpHttpUrl);
  const chromeTargetId =
    argValue('--chrome-target-id') ?? process.env.SPYGLASS_CHROME_TARGET_ID ?? info?.chromeTargetId;
  const excludeTargetIds =
    typeof chromeTargetId === 'string' && chromeTargetId.length > 0 ? [chromeTargetId] : [];
  const guest = pickGuestTarget(targets, guestUrl, { excludeTargetIds });
  if (guest === undefined) {
    fail('No guest CDP target (WebContentsView) found');
    return;
  }

  const { Stagehand } = await import(resolveStagehandSpecifier());
  const browserWs = cdpUrl.startsWith('ws') ? cdpUrl : await resolveBrowserWebSocket(cdpHttpUrl);
  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 0,
    disablePino: true,
    keepAlive: true,
    selfHeal: false,
    model: 'openai/gpt-4.1-mini',
    llmClient: stub,
    localBrowserLaunchOptions: {
      cdpUrl: browserWs,
      preserveUserDataDir: true
    }
  });

  const results = [];
  try {
    await stagehand.init();
    const pages =
      stagehand.context && typeof stagehand.context.pages === 'function'
        ? stagehand.context.pages()
        : [];
    const match = pickStagehandPage(pages, guest, { excludeTargetIds });
    if (match === undefined) {
      fail('No Stagehand page matched the picked guest.');
      return;
    }
    if (stagehand.context?.setActivePage) {
      stagehand.context.setActivePage(match);
    }

    for (const action of actions) {
      const observeResult = {
        selector: String(action.selector ?? ''),
        description: String(action.description ?? action.selector ?? 'action'),
        method: String(action.method ?? 'click'),
        arguments: Array.isArray(action.arguments)
          ? action.arguments.map((item) => String(item))
          : []
      };
      try {
        if (isCheckReplayMethod(observeResult.method)) {
          const desired = desiredCheckedState(observeResult.method, observeResult.arguments);
          await applySetChecked(match, observeResult.selector, desired);
          results.push({
            selector: observeResult.selector,
            method: observeResult.method,
            success: true,
            message: `setChecked ${String(desired)}`
          });
          continue;
        }
        const acted = await stagehand.act(observeResult, { page: match });
        results.push({
          selector: observeResult.selector,
          method: observeResult.method,
          success: acted?.success !== false,
          message: acted?.message ?? 'ok'
        });
      } catch (error) {
        results.push({
          selector: observeResult.selector,
          method: observeResult.method,
          success: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const ok = results.every((row) => row.success) && stub.calls === 0;
    const payload = {
      ok,
      llmCalls: stub.calls,
      results,
      guestUrl: guest.url,
      cdpUrl,
      targetId: guest.id
    };
    if (!ok) {
      payload.error =
        stub.calls > 0
          ? `LLM was called ${String(stub.calls)} time(s)`
          : 'One or more act() calls failed';
      process.exitCode = 1;
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    const payload = {
      ok: false,
      llmCalls: stub.calls,
      results,
      guestUrl: guest.url,
      cdpUrl,
      error: error instanceof Error ? error.message : String(error)
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
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
