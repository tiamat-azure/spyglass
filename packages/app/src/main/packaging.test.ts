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
    const voiceEditIdx = main.indexOf('IPC.voiceEdit');
    expect(voiceEditIdx).toBeGreaterThan(-1);
    const voiceEditHandler = main.slice(voiceEditIdx, voiceEditIdx + 1800);
    expect(voiceEditHandler).toContain(
      '/* L7-022: upgrade bookkeeping must not fail voice-edit */'
    );
    expect(voiceEditHandler).toContain('[spyglass] STT upgrade bookkeeping failed:');
    expect(voiceEditHandler).toContain('console.error');
    expect(voiceEditHandler).toContain('newlyProposed');
    expect(voiceEditHandler).toContain('sttUpgradeDecideInFlight === 0');
    expect(voiceEditHandler.indexOf('const before = store.snapshot(modelDir)')).toBeLessThan(
      voiceEditHandler.indexOf('await store.recordCorrection()')
    );
    expect(voiceEditHandler.indexOf('await store.recordCorrection()')).toBeLessThan(
      voiceEditHandler.indexOf('newlyProposed')
    );
    const ws = readFileSync(join(appRoot, '../../packages/stt/src/ws-localhost.ts'), 'utf8');
    expect(ws).toContain('export function isLoopbackWsHost');
    expect(ws).not.toContain("startsWith('127.0.0.1')");
    expect(ws).not.toContain('startsWith("127.0.0.1")');
    const sidecar = readFileSync(join(appRoot, '../../packages/stt/src/sidecar.ts'), 'utf8');
    expect(sidecar).toContain('sessions.set(message.utteranceId');
    expect(sidecar).toContain('Do not abort or reuse a shared session');
    expect(sidecar).toContain('await createEngineFromEnvAsync');
    expect(sidecar).not.toContain('await createEngineFromEnv(');
    expect(main).toContain('await voiceBridge?.stopCapture()');
    expect(bridge).toContain('releaseSidecarTransport');
    expect(bridge).toContain('setCaptureMode');
    expect(voiceUi).toContain('setArmed');
    expect(renderer).toContain('voice?.setArmed(recording)');
    const whisper = readFileSync(join(appRoot, '../../packages/stt/src/whisper-engine.ts'), 'utf8');
    expect(whisper).toContain('process.kill(-job.child.pid');
    expect(whisper).toContain('dispose(): void');
    expect(whisper).toContain('WHISPER_TIMEOUT_MS_DEFAULT');
    const pickStart = whisper.indexOf('export function pickPreferredWhisperModel');
    const pickEnd = whisper.indexOf('export function whisperAvailable');
    expect(pickStart).toBeGreaterThan(-1);
    expect(pickEnd).toBeGreaterThan(pickStart);
    const pickBody = whisper.slice(pickStart, pickEnd);
    expect(pickBody.indexOf('configuredSttModelFile')).toBeGreaterThan(-1);
    expect(pickBody.indexOf('configuredSttModelFile')).toBeLessThan(
      pickBody.indexOf('basename(path) === STT_LARGE_MODEL_FILE')
    );
    expect(pickBody).toContain('preferSmallAfterLargeFallback');
    expect(pickBody).toContain('readFallbackMarkerForPathPick');
    expect(pickBody).toContain('isUnreadableLargeFallbackError');
    expect(pickBody).toContain('readLargeFallbackSync');
    expect(pickBody).toContain('largeFallbackMarkerDirs');
    expect(pickBody).toContain('skipLarge');
    expect(pickBody).toContain('if (skipLarge)');
    expect(pickBody.indexOf('if (skipLarge)')).toBeLessThan(
      pickBody.indexOf('return nonLarge ?? existing[0]')
    );
    expect(whisper).toContain('isLargeFallbackError');
    expect(main).toContain("error: 'inactive'");
    expect(main).toContain('activeReplay === undefined');
    const replayNextIdx = main.indexOf('IPC.replayNext');
    const replayStopIdx = main.indexOf('IPC.replayStop');
    expect(replayNextIdx).toBeGreaterThan(-1);
    expect(replayStopIdx).toBeGreaterThan(replayNextIdx);
    const replayNextHandler = main.slice(replayNextIdx, replayStopIdx);
    expect(replayNextHandler).not.toContain('activeReplay?.next()');
    expect(replayNextHandler).toContain('activeReplay.next()');
    const replayStartIdx = main.indexOf('IPC.replayStart');
    expect(replayStartIdx).toBeGreaterThan(-1);
    const replayStartHandler = main.slice(replayStartIdx, replayNextIdx);
    expect(replayStartHandler).toContain('parseReplayStartPayload');
    expect(replayStartHandler).toContain("error: 'invalid payload'");
    expect(replayNextHandler).toContain('try {');
    expect(replayNextHandler).toContain('catch (error)');
    expect(preload).toContain('payload.datasetPath');
    expect(renderer).toContain("requireEl<HTMLInputElement>('replay-dataset')");
    expect(renderer).toContain('api.replay');
    expect(renderer).toContain('.start(forceAi, !forceAi, stepByStep, datasetPath)');
    const replayStopHandler = main.slice(replayStopIdx, main.indexOf('IPC.sessionExport'));
    expect(replayStopHandler).toContain('activeReplay.stop()');
    expect(replayStopHandler).toContain('try {');
    expect(replayStopHandler).toContain('catch (error)');
    expect(preload).toContain('IPC.voiceSetMode');
    const ipcShared = readFileSync(join(appRoot, 'src/shared/ipc.ts'), 'utf8');
    expect(ipcShared).toContain('export type SttUpgradeDecideResponse');
    expect(ipcShared).toContain('{ ok: true } | { ok: false; error: string }');
    expect(ipcShared).toContain('datasetPath?: string');
    expect(preload).toContain('SttUpgradeDecideResponse');
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
    expect(renderer).toContain('stt-upgrade-refuse');
    const refuseIdx = renderer.indexOf('sttUpgradeRefuse.addEventListener');
    expect(refuseIdx).toBeGreaterThan(-1);
    const refuseHandler = renderer.slice(refuseIdx, refuseIdx + 1100);
    expect(refuseHandler).toContain('result.ok');
    expect(refuseHandler).toContain('sttUpgrade.hidden = true');
    expect(refuseHandler).toContain('sttUpgradeRefuse.disabled = true');
    expect(refuseHandler).toContain('sttUpgradeRefuse.disabled = false');
    expect(refuseHandler).toContain('sttUpgradeAccept.disabled = true');
    expect(refuseHandler).toContain('sttUpgradeAccept.disabled = false');
    const acceptIdx = renderer.indexOf('sttUpgradeAccept.addEventListener');
    expect(acceptIdx).toBeGreaterThan(-1);
    const acceptHandler = renderer.slice(acceptIdx, acceptIdx + 1100);
    expect(acceptHandler).toContain('result.ok');
    expect(acceptHandler).toContain('result.error');
    expect(acceptHandler).toContain('sttUpgradeAccept.disabled = false');
    expect(acceptHandler).toContain('sttUpgradeRefuse.disabled = true');
    expect(acceptHandler).toContain('sttUpgradeRefuse.disabled = false');
    expect(main).toContain("error: 'bad-request'");
    expect(main).toContain("error: 'forbidden'");
    expect(main).toContain('sessionBundleIpcError');
    expect(main).toContain("'export-failed'");
    const resolveEngine = readFileSync(
      join(appRoot, '../../packages/stt/src/resolve-engine.ts'),
      'utf8'
    );
    expect(resolveEngine).toContain('await recordFirstUseLatency');
    expect(resolveEngine).toContain('export function createEngineFromEnv(');
    expect(resolveEngine).not.toContain('export async function createEngineFromEnv(');
    expect(resolveEngine).toContain('export async function createEngineFromEnvAsync(');
    expect(resolveEngine).toContain('basename(model) === STT_LARGE_MODEL_FILE');
    expect(resolveEngine).not.toContain('sameResolvedPath(model, ctx.selection.largePath)');
    expect(resolveEngine).toContain('selection.largeOk');
    expect(resolveEngine).not.toContain('existsSync(ctx.selection.largePath)');
    expect(resolveEngine).toContain('largeFallbackMarkerDirs');
    expect(resolveEngine).toContain('readAlignedLargeFallbackSync');
    expect(resolveEngine).toContain('explicitIsLargeFile');
    expect(resolveEngine).toContain('selection.explicitOk');
    expect(resolveEngine).toContain('parseWhisperTimeoutMs(env)');
    expect(resolveEngine).toContain('parseMaxLatencyMs(env)');
    expect(resolveEngine).not.toContain('env.STT_MAX_LATENCY_MS');
    expect(resolveEngine).not.toContain('STT_WHISPER_TIMEOUT_MS');
    expect(main).toContain('function resolveSttModelDir');
    const resolveDir = main.slice(
      main.indexOf('function resolveSttModelDir'),
      main.indexOf('async function pickSessionDirectory')
    );
    expect(resolveDir).toContain('return fromEnv.trim()');
    expect(whisper).toContain('firstUsePending');
    expect(whisper).toContain('void noteFirstUse');
    expect(whisper).toContain('warnOnFinalFailure');
    expect(whisper).toContain('console.warn');
    const downloadModel = readFileSync(
      join(appRoot, '../../packages/stt/src/download-model.ts'),
      'utf8'
    );
    expect(downloadModel).toContain('body.cancel()');
    expect(downloadModel).toContain('content-encoding');
    const sessionBundle = readFileSync(
      join(appRoot, '../../packages/runner/src/session-bundle.ts'),
      'utf8'
    );
    expect(sessionBundle).toContain('destination is not empty');
    expect(sessionBundle).toContain('destination is not a directory');
    expect(sessionBundle).toContain('session already exists');
    expect(sessionBundle).toContain('mtimeMs');
    expect(sessionBundle).toContain('refused: symlinks are not allowed');
    expect(sessionBundle).toContain("action: 'import' | 'export'");
    const importFn = sessionBundle.slice(
      sessionBundle.indexOf('export async function importSessionFolder')
    );
    expect(importFn.indexOf("assertNoSymlinks(source, 'import')")).toBeGreaterThan(-1);
    expect(importFn.indexOf("assertNoSymlinks(source, 'import')")).toBeLessThan(
      importFn.indexOf('readSessionMeta(source)')
    );
    const exportFn = sessionBundle.slice(
      sessionBundle.indexOf('export async function exportSessionFolder'),
      sessionBundle.indexOf('export async function importSessionFolder')
    );
    expect(exportFn).toContain("assertNoSymlinks(source, 'export')");
    expect(exportFn).toContain('assertExportDestIsDirectoryIfPresent');
    expect(exportFn).toContain("assertNoSymlinks(staging, 'export')");
    expect(exportFn.indexOf('await cp(source, staging')).toBeLessThan(
      exportFn.indexOf("assertNoSymlinks(staging, 'export')")
    );
    const destLock = sessionBundle.slice(
      sessionBundle.indexOf('async function withDestLock'),
      sessionBundle.indexOf('function isSafeSessionId')
    );
    expect(destLock).toContain('const queued = previous.then(() => held)');
    expect(destLock).toContain('destLocks.get(key) === queued');
    const replaceFn = sessionBundle.slice(sessionBundle.indexOf('async function replaceDirectory'));
    expect(replaceFn.startsWith('async function replaceDirectory')).toBe(true);
    expect(replaceFn).not.toMatch(/await recoverOrphanedBackup\(dest\)/);
    const noOverwritePublish = replaceFn.slice(0, replaceFn.indexOf('const backup'));
    expect(noOverwritePublish).toContain('pathExists(dest)');
    expect(noOverwritePublish).not.toContain("code === 'EPERM'");
    expect(noOverwritePublish).toContain('allowEmptyDest');
    expect(noOverwritePublish).toContain('vacateEmptyDirectory(dest)');
    const replaceCatch = replaceFn.slice(replaceFn.indexOf('} catch (error)'));
    expect(replaceCatch).not.toContain('await rm(dest');
    expect(replaceCatch).toContain('await rename(backup, dest)');
    expect(replaceCatch).toContain('console.error');
    expect(replaceCatch).toContain('throw error');
    expect(main).toContain("error: 'fallback-unreadable'");
    expect(main).toContain("error: 'store-unavailable'");
    expect(main).toContain('sttUpgradeDecideInFlight');
    expect(main).toContain('sttUpgradeDecideInFlight += 1');
    const decideFn = main.slice(main.indexOf('IPC.sttUpgradeDecide'));
    expect(decideFn).toContain('sttUpgradeFakeEnabled(process.env, app.isPackaged)');
    expect(decideFn).toContain('resolveSttLargeExpectedSha256(process.env, app.isPackaged)');
    expect(decideFn).toContain('enqueueSttUpgradeDecide');
    expect(decideFn).toContain('refusedPermanently');
    expect(decideFn).toContain("error: 'refused'");
    expect(decideFn).toContain('existingVerifiedDownloadOk');
    expect(decideFn).toContain('STT_LARGE_MIN_BYTES');
    expect(decideFn).toContain('await rm(dest, { force: true })');
    expect(decideFn.indexOf('existingVerifiedDownloadOk')).toBeLessThan(
      decideFn.indexOf('downloadUrlToFileAtomic')
    );
    expect(decideFn).not.toContain('largeModelPresent');
    expect(decideFn).not.toContain("process.env.SPYGLASS_STT_UPGRADE_FAKE === '1'");
    expect(decideFn).not.toContain('process.env.STT_LARGE_SHA256');
    const upgradeStore = readFileSync(join(appRoot, 'src/main/stt-upgrade-store.ts'), 'utf8');
    expect(upgradeStore).toContain('writeFileAtomic');
    expect(upgradeStore).toContain('persistQueue');
    expect(upgradeStore).toContain('this.disk = candidate');
    const ipcValidate = readFileSync(join(appRoot, 'src/main/ipc-validate.ts'), 'utf8');
    expect(ipcValidate).not.toContain('parsePathPayload');
    expect(inProcess).toContain('export function createInProcessStt(');
    expect(inProcess).not.toContain('export async function createInProcessStt(');
    expect(inProcess).toContain('createInProcessSttFromEnv');
    expect(inProcess).toContain('createEngineFromEnvAsync');
    expect(inProcess).toContain('wrapInProcessStt(createEngineFromEnv(env))');
    expect(inProcess).not.toContain('await createEngineFromEnv(');
    expect(inProcess).not.toContain('createMockEngine');
    expect(bridge).toContain('createInProcessSttFromEnv');
    expect(bridge).toContain('await createInProcessSttFromEnv');
    expect(bridge).toContain('STT in-process engine failed');
    expect(bridge).not.toMatch(/createInProcessStt\(/);
    const exportIdx = renderer.indexOf('sessionExportBtn.addEventListener');
    expect(exportIdx).toBeGreaterThan(-1);
    const exportHandler = renderer.slice(exportIdx, exportIdx + 1200);
    expect(exportHandler).not.toContain('window.prompt');
    expect(exportHandler).toContain('sessionExportBtn.disabled = true');
    expect(exportHandler).toContain('.catch((error: unknown) => {');
    expect(exportHandler).toContain('replayStatus.textContent');
    const importIdx = renderer.indexOf('sessionImportBtn.addEventListener');
    expect(importIdx).toBeGreaterThan(-1);
    const importHandler = renderer.slice(importIdx, importIdx + 1200);
    expect(importHandler).not.toContain('window.prompt');
    expect(importHandler).toContain('sessionImportBtn.disabled = true');
    expect(importHandler).toContain('.catch((error: unknown) => {');
    const nextIdx = renderer.indexOf('replayNextBtn.addEventListener');
    const haltIdx = renderer.indexOf('replayHaltBtn.addEventListener');
    expect(nextIdx).toBeGreaterThan(-1);
    expect(haltIdx).toBeGreaterThan(nextIdx);
    const nextHandler = renderer.slice(nextIdx, haltIdx);
    expect(nextHandler).toContain('replayNextBtn.disabled = true');
    expect(nextHandler).toContain('api.replay');
    expect(nextHandler).toContain('result.ok');
    expect(nextHandler).toContain('result.error');
    expect(nextHandler).toContain('replayHalted');
    expect(nextHandler).toContain('replayStepwiseActive');
    expect(nextHandler).not.toContain('!replayHaltBtn.disabled');
    const haltHandler = renderer.slice(haltIdx, haltIdx + 1100);
    expect(haltHandler).toContain('api.replay');
    expect(haltHandler).toContain('result.ok');
    expect(haltHandler).toContain('result.error');
    expect(haltHandler).toContain('.catch((error: unknown) => {');
    expect(haltHandler).toContain('replayHalted = true');
    expect(haltHandler).toContain('replayNextBtn.disabled = true');
    expect(haltHandler).toContain('replayHaltBtn.disabled = true');
    const statusStart = renderer.indexOf('void api.sttUpgrade');
    const statusEnd = renderer.indexOf('void api.stagehand.cdp()');
    expect(statusStart).toBeGreaterThan(-1);
    expect(statusEnd).toBeGreaterThan(statusStart);
    const statusCall = renderer.slice(statusStart, statusEnd);
    expect(statusCall).toContain('.status()');
    expect(statusCall).toContain('.catch(');
    expect(statusCall).toContain('sttUpgrade.hidden = true');
    const closeElectron = readFileSync(join(appRoot, 'e2e/close-electron.ts'), 'utf8');
    expect(closeElectron).toContain('clearTimeout(timer)');
    expect(closeElectron).toContain('timer.unref()');
    expect(closeElectron).toContain("kill('SIGKILL')");
    expect(closeElectron).toContain("['/pid', String(child.pid), '/T', '/F']");
    expect(closeElectron).toContain("once('exit'");
    expect(closeElectron).toContain('KILL_EXIT_GRACE_MS');
    expect(closeElectron).not.toContain('child.killed === true');
    expect(closeElectron).toContain('void closing.catch(() => {})');
    expect(closeElectron).toContain('ELECTRON_CLOSE_TIMEOUT_MESSAGE');
    expect(closeElectron).toContain('if (!timedOut)');
    expect(closeElectron).toContain('throw error');
    const closeStart = closeElectron.indexOf('export async function closeElectron');
    const closeEnd = closeElectron.indexOf('export function killElectronChild');
    expect(closeStart).toBeGreaterThan(-1);
    expect(closeEnd).toBeGreaterThan(closeStart);
    const closeBody = closeElectron.slice(closeStart, closeEnd);
    expect(closeBody.indexOf('if (!timedOut)')).toBeLessThan(closeBody.indexOf('throw error'));
    expect(closeBody.indexOf('throw error')).toBeLessThan(
      closeBody.indexOf('killElectronChild(child)')
    );
    expect(closeBody).not.toMatch(/catch \(error\) \{\s*killElectronChild/);
  });
});
