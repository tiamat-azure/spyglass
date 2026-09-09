import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('packaged Observe', () => {
  it('ships Stagehand and playwright-core as production dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@browserbasehq/stagehand']).toBe('3.7.3');
    expect(pkg.dependencies?.zod).toBe('3.25.76');
    expect(pkg.dependencies?.['@spyglass/stt']).toBe('workspace:*');
    expect(pkg.dependencies?.['playwright-core']).toBe('1.63.0');
    expect(pkg.devDependencies?.['@browserbasehq/stagehand']).toBeUndefined();
  });

  it('includes the observe script, act script, and shared guest matcher in the electron-builder payload', () => {
    const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('scripts/stagehand-observe.mjs');
    expect(yml).toContain('scripts/stagehand-act.mjs');
    expect(yml).toContain('scripts/cdp-guest.mjs');
    expect(yml).toContain('vendor/whisper');
  });

  it('observe worker imports the shared guest matcher and fails closed on page match', () => {
    const observe = readFileSync(join(appRoot, 'scripts/stagehand-observe.mjs'), 'utf8');
    expect(observe).toContain("from './cdp-guest.mjs'");
    expect(observe).toContain('pickGuestTarget');
    expect(observe).toContain('pickStagehandPage');
    expect(observe).toContain('No guest CDP target');
    expect(observe).not.toContain('matching[matching.length - 1]');
    expect(observe).not.toContain('!isChromeUiUrl(url) && url.length > 0');
    const act = readFileSync(join(appRoot, 'scripts/stagehand-act.mjs'), 'utf8');
    expect(act).toContain("from './cdp-guest.mjs'");
    expect(act).toContain('selfHeal: false');
    expect(act).toContain('Lot 1 act() must not call an LLM');
    expect(act).toContain('stagehand.act(observeResult');
    expect(act).toContain('setChecked');
    expect(act).toContain('applySetChecked');
    expect(act).toContain('deepLocator');
    expect(act).not.toContain('document.querySelector');
    expect(act).toContain('refusing click-toggle (C1b)');
    expect(act).toContain('locator.setChecked');
    expect(act).toContain('locator.click');
    expect(act).not.toContain('Runtime.callFunctionOn');
    expect(act).not.toContain('el.checked = desired');
    expect(act).toContain('existsSync(fromArg)');
    expect(act).toContain('await readFile(fromArg');
    const actSpawn = readFileSync(join(appRoot, 'src/main/stagehand-act.ts'), 'utf8');
    expect(actSpawn).toContain("flags.push('--actions', actionsPath)");
    expect(actSpawn).toContain('mkdtemp');
    expect(actSpawn).toContain('rm(actionsDir');
    expect(actSpawn).toContain('delete childEnv.SPYGLASS_ACT_ACTIONS');
    expect(actSpawn).not.toContain('SPYGLASS_ACT_ACTIONS = JSON.stringify');
    const orch = readFileSync(join(appRoot, 'src/main/session-orchestrator.ts'), 'utf8');
    expect(orch).toContain('await this.probe.drainPendingInputs()');
    const stopFn = orch.slice(orch.indexOf('async stop('), orch.indexOf('async retract('));
    expect(stopFn).toContain('enqueueWrite');
    expect(stopFn).toContain('drainPendingInputs');
    expect(stopFn).toContain('processProbePayload');
    expect(stopFn).not.toContain('setTimeout(resolve, 0)');
    expect(stopFn).not.toContain('flushPendingInputs');
    expect(stopFn.indexOf('drainPendingInputs')).toBeLessThan(
      stopFn.indexOf("this.state = 'stopping'")
    );
    expect(stopFn.indexOf('processProbePayload')).toBeLessThan(
      stopFn.indexOf("this.state = 'stopping'")
    );
    expect(stopFn.indexOf('flushPendingClick')).toBeLessThan(
      stopFn.indexOf("this.state = 'stopping'")
    );
    expect(stopFn.indexOf('enqueueWrite')).toBeLessThan(stopFn.indexOf("this.state = 'stopping'"));
    expect(stopFn.indexOf('onBeforeSeal')).toBeLessThan(stopFn.indexOf("this.state = 'stopping'"));
    expect(stopFn.indexOf('onBeforeStop')).toBeLessThan(stopFn.indexOf('enqueueWrite'));
    expect(stopFn).toContain('onStopRolledBack');
    expect(orch).toContain('AsyncLocalStorage');
    expect(stopFn.indexOf("this.state = 'stopping'")).toBeLessThan(
      stopFn.indexOf("kind: 'record.stop'")
    );
    const probeHost = readFileSync(join(appRoot, 'src/main/probe-host.ts'), 'utf8');
    expect(probeHost).toContain('drainPendingInputs');
    expect(probeHost).toContain('eventsJson');
    expect(probeHost).toContain('probe flush hook missing');
    expect(probeHost).not.toContain('flushPendingInputs');
    const matcher = readFileSync(join(appRoot, 'scripts/cdp-guest.mjs'), 'utf8');
    expect(matcher).toContain('pageMatchesPickedGuest');
    expect(matcher).toContain('pickStagehandPage');
    expect(matcher).not.toContain('eligible[0] ?? pages[0]');
    expect(matcher).toContain('isLoopbackHostname');
    expect(matcher).toContain('isDottedIpv4Loopback');
    expect(matcher).toContain('ipv4OctetsFromMappedTail');
    expect(matcher).not.toContain("mapped.startsWith('7f')");
    const main = readFileSync(join(appRoot, 'src/main/index.ts'), 'utf8');
    expect(main).toContain('getOrCreateDevToolsTargetId');
    const raise = main.slice(
      main.indexOf('IPC.usageRaiseCeiling'),
      main.indexOf('IPC.layoutGuestVisible')
    );
    expect(raise).toContain('observerRuntime === undefined');
    expect(raise).toContain('return { ok: false }');
    expect(raise).not.toContain('observerRuntime?.observer.raiseCeiling');
  });

  it('asarUnpacks Stagehand runtime node_modules for packaged Observe', () => {
    const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('node_modules/**');
    expect(yml).toMatch(/asarUnpack:/);
  });

  it('does not pass remote-allow-origins=*', () => {
    const src = readFileSync(join(appRoot, 'src/main/cdp-origins.ts'), 'utf8');
    const portSrc = readFileSync(join(appRoot, 'src/main/cdp-port.ts'), 'utf8');
    expect(src).toContain("CDP_REMOTE_ALLOW_ORIGINS = ''");
    expect(src).not.toContain("= '*'");
    expect(portSrc).toContain('CDP_REMOTE_ALLOW_ORIGINS');
    expect(portSrc).not.toMatch(/remote-allow-origins',\s*'\*'/);
  });

  it('keeps STT sockets in main and defaults AUDIO_RETENTION to none', () => {
    const renderer = readFileSync(join(appRoot, 'src/renderer/src/main.ts'), 'utf8');
    const voiceUi = readFileSync(join(appRoot, 'src/renderer/src/voice-capture.ts'), 'utf8');
    const preload = readFileSync(join(appRoot, 'src/preload/index.ts'), 'utf8');
    const combined = `${renderer}\n${voiceUi}\n${preload}`;
    expect(combined).not.toMatch(/new WebSocket/);
    expect(combined).not.toMatch(/ws:\/\//);
    expect(preload).toContain('IPC.voiceFrame');
    const vite = readFileSync(join(appRoot, 'electron.vite.config.ts'), 'utf8');
    expect(vite).toContain('stt-sidecar');
    const orch = readFileSync(join(appRoot, 'src/main/session-orchestrator.ts'), 'utf8');
    expect(orch).toContain('parseAudioRetention');
    expect(orch).toContain('audioRef: null');
    expect(orch).toContain('startTs < lastCapture.ts');
    const correlate = readFileSync(join(appRoot, '../../packages/stt/src/correlate.ts'), 'utf8');
    expect(correlate).toContain('startTs < lastDom.ts');
    const bridge = readFileSync(join(appRoot, 'src/main/voice-bridge.ts'), 'utf8');
    expect(bridge).toContain('ws://127.0.0.1');
    expect(bridge).toContain('gateVadUtterance');
    expect(bridge).toContain('createVadState');
    expect(voiceUi).not.toMatch(/catch\s*\{[\s\S]{0,80}pumpFake\(\)/);
    expect(voiceUi).toContain('createGain');
    expect(voiceUi).toContain('gain.value = 0');
    const install = readFileSync(join(appRoot, 'src/main/web-security-install.ts'), 'utf8');
    expect(install).toContain('mediaTypes');
    expect(orch).toContain("this.audioRetention !== 'none'");
    expect(orch).toContain('asEditedVoiceTranscript');
    expect(bridge).toContain('this.capturing = true');
    expect(bridge).toContain('pcmByUtterance');
    expect(bridge).toContain('dropUtterance');
    expect(voiceUi).toContain('resampleToSttPcm');
    expect(voiceUi).toContain('await abort()');
    expect(renderer).toContain('message.transcript');
    const main = readFileSync(join(appRoot, 'src/main/index.ts'), 'utf8');
    expect(main).toContain('IPC.voiceAbort');
    expect(main).toContain('voiceBridge?.abort()');
    const ws = readFileSync(join(appRoot, '../../packages/stt/src/ws-localhost.ts'), 'utf8');
    expect(ws).toContain('export function isLoopbackWsHost');
    expect(ws).not.toContain("startsWith('127.0.0.1')");
    expect(ws).not.toContain('startsWith("127.0.0.1")');
    const sidecar = readFileSync(join(appRoot, '../../packages/stt/src/sidecar.ts'), 'utf8');
    expect(sidecar).toContain('sessions.set(message.utteranceId');
    expect(sidecar).toContain('Do not abort or reuse a shared session');
    expect(main).toContain('await voiceBridge?.stopCapture()');
    expect(bridge).toContain('releaseSidecarTransport');
    expect(bridge).toContain('setCaptureMode');
    expect(voiceUi).toContain('setArmed');
    expect(renderer).toContain('voice?.setArmed(recording)');
    const whisper = readFileSync(join(appRoot, '../../packages/stt/src/whisper-engine.ts'), 'utf8');
    expect(whisper).toContain('process.kill(-job.child.pid');
    expect(whisper).toContain('dispose(): void');
    expect(whisper).toContain('WHISPER_TIMEOUT_MS_DEFAULT');
    expect(preload).toContain('IPC.voiceSetMode');
    expect(bridge).toContain('VOICE_FLUSH_MS');
    expect(bridge).not.toContain('sleep(4_000)');
    expect(bridge).toContain('this.trackFinal(journal)');
    expect(bridge).toContain('void journal.finally');
    expect(bridge).toContain('detached: true');
    expect(bridge).toContain('process.kill(-pid');
    expect(sidecar).toContain('engine.dispose?.()');
    expect(voiceUi).toContain('stillLive');
    expect(voiceUi).toContain('stopTracks(late)');
    expect(voiceUi).toContain('armed = next');
    expect(voiceUi).toContain('stopGraph()');
    expect(renderer).toContain('voice?.setArmed(false)');
    expect(main).toContain("state: 'stopping'");
    const inProcess = readFileSync(join(appRoot, '../../packages/stt/src/in-process.ts'), 'utf8');
    expect(inProcess).toContain('pendingFinalizeId');
    expect(inProcess).toContain('engine.dispose?.()');
    expect(bridge).toContain('this.inProcess?.abort()');
    expect(whisper).toContain('killJobs(utteranceId)');
    expect(whisper).toContain('process.execPath');
    expect(whisper).toContain('windowsHide');
    expect(voiceUi).toContain('await api.voice.abort()');
    expect(bridge).toContain('captureEpoch');
    expect(bridge).toContain('invalidateCapture');
    expect(bridge).toContain('canCapture');
    expect(main).toContain('beginStop');
    expect(main).toContain('resumeCapture');
    expect(main).toContain('canCapture');
    expect(bridge).toContain('beginStop');
    expect(bridge).toContain('this.stopping');
    expect(bridge).toContain('voice capture refused');
    expect(main).toContain("error: 'voice capture refused'");
    expect(main).toContain('onStopRolledBack');
    expect(main).toContain("state.state === 'recording'");
    expect(main).toContain('dialog.showOpenDialog');
    expect(main).toContain("pickSessionDirectory(winRef.current, 'Exporter la session', true)");
    expect(main).toContain("pickSessionDirectory(winRef.current, 'Importer une session', false)");
    expect(renderer).toContain('exportSession');
    expect(renderer).toContain('importSession');
    expect(renderer).toContain('sttUpgradeCopyDefault');
    expect(renderer).toContain('sttUpgradeCopy.innerHTML = sttUpgradeCopyDefault');
    expect(main).toContain('function resolveSttModelDir');
    expect(whisper).toContain('firstUsePending');
    const downloadModel = readFileSync(
      join(appRoot, '../../packages/stt/src/download-model.ts'),
      'utf8'
    );
    expect(downloadModel).toContain('body?.cancel()');
    const sessionBundle = readFileSync(
      join(appRoot, '../../packages/runner/src/session-bundle.ts'),
      'utf8'
    );
    expect(sessionBundle).toContain('destination is not empty');
    expect(sessionBundle).toContain('session already exists');
    expect(sessionBundle).toContain('mtimeMs');
    const importFn = sessionBundle.slice(
      sessionBundle.indexOf('export async function importSessionFolder')
    );
    expect(importFn.indexOf('assertNoSymlinks(source)')).toBeGreaterThan(-1);
    expect(importFn.indexOf('assertNoSymlinks(source)')).toBeLessThan(
      importFn.indexOf('readSessionMeta(source)')
    );
    const replaceFn = sessionBundle.slice(sessionBundle.indexOf('async function replaceDirectory'));
    expect(replaceFn.startsWith('async function replaceDirectory')).toBe(true);
    expect(replaceFn).not.toMatch(/await recoverOrphanedBackup\(dest\)/);
    expect(main).toContain("error: 'fallback-unreadable'");
    const upgradeStore = readFileSync(join(appRoot, 'src/main/stt-upgrade-store.ts'), 'utf8');
    expect(upgradeStore).toContain('writeFileAtomic');
    expect(upgradeStore).toContain('persistQueue');
    const ipcValidate = readFileSync(join(appRoot, 'src/main/ipc-validate.ts'), 'utf8');
    expect(ipcValidate).not.toContain('parsePathPayload');
    expect(inProcess).toContain('export function createInProcessStt(');
    expect(inProcess).not.toContain('export async function createInProcessStt(');
    expect(inProcess).toContain('createInProcessSttFromEnv');
    expect(bridge).toContain('createInProcessSttFromEnv');
    const exportIdx = renderer.indexOf('sessionExportBtn.addEventListener');
    expect(exportIdx).toBeGreaterThan(-1);
    expect(renderer.slice(exportIdx, exportIdx + 900)).not.toContain('window.prompt');
    const importIdx = renderer.indexOf('sessionImportBtn.addEventListener');
    expect(importIdx).toBeGreaterThan(-1);
    expect(renderer.slice(importIdx, importIdx + 900)).not.toContain('window.prompt');
  });
});
