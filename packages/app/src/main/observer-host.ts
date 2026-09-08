import { join } from 'node:path';
import { FastTokenBudget, LlmGateway } from '@spyglass/llm';
import { app, type BrowserWindow, safeStorage } from 'electron';
import { IPC } from '../shared/ipc.ts';
import { batchMsFromEnv, isLlmOffline, selectTransport } from './llm-transport.ts';
import { ObserverAgent } from './observer-agent.ts';
import type { SessionOrchestrator } from './session-orchestrator.ts';
import { electronSafeStorageVault, SettingsStore } from './settings-store.ts';

export type ObserverRuntime = {
  settings: SettingsStore;
  observer: ObserverAgent;
  gateway: LlmGateway;
};

export async function createObserverRuntime(
  win: BrowserWindow,
  session: () => SessionOrchestrator
): Promise<ObserverRuntime> {
  const settings = new SettingsStore(
    join(app.getPath('userData'), 'settings.json'),
    electronSafeStorageVault(safeStorage),
    process.env
  );
  await settings.load();

  const transport = selectTransport(process.env, settings.profileConfig('fast').apiKey.length > 0);
  const gateway = new LlmGateway({
    transport,
    profiles: () => ({
      fast: settings.profileConfig('fast'),
      smart: settings.profileConfig('smart')
    })
  });
  const budget = new FastTokenBudget({
    ceiling: settings.sessionTokenLimitFast(),
    warnRatio: settings.tokenWarnRatio(),
    rateLimitPerMin: settings.rateLimitCallsPerMin()
  });
  const windowMs = batchMsFromEnv(process.env);
  const observer = new ObserverAgent(
    {
      emitChat: (message) => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC.chatMessage, message);
        }
      },
      emitEnriched: (payload) => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC.chatEnriched, payload);
        }
      },
      emitUsage: (usage) => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC.usageUpdate, usage);
        }
      },
      appendAgent: async (partial) => {
        await session().appendAgentEvent(partial);
      }
    },
    {
      gateway,
      budget,
      windowMs,
      enrichmentEnabled: () => settings.enrichmentEnabled() && !isLlmOffline(process.env),
      modelName: () => settings.profileConfig('fast').model
    }
  );
  if (!settings.enrichmentEnabled() || isLlmOffline(process.env)) {
    observer.setEnabled(false);
    if (isLlmOffline(process.env)) {
      observer.setOffline(true);
    }
  }
  return { settings, observer, gateway };
}
