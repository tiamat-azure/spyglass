import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createInProcessSttFromEnv,
  createVadState,
  frameDurationMs,
  gateVadUtterance,
  type InProcessStt,
  parseServerMessage,
  parseVoiceFlushMs,
  pcmRms,
  type ServerMessage,
  type SidecarHandle,
  STT_SAMPLE_RATE,
  type SttEngineName,
  startSidecarServer,
  type VadState,
  type VoiceMode
} from '@spyglass/stt';

export type VoiceBridgeHandlers = {
  onPartial: (payload: { utteranceId: string; text: string; startTs: number }) => void;
  onFinal: (payload: {
    utteranceId: string;
    text: string;
    startTs: number;
    endTs: number;
    pcm: Buffer;
  }) => void | Promise<void>;
  onLevel: (rms: number) => void;
  onError: (message: string) => void;
};

export type VoiceBridgeStatus = {
  engine: SttEngineName;
  model: string;
  fakeCapture: boolean;
};

type LiveUtterance = {
  id: string;
  startTs: number;
};

function sidecarScriptPath(): string | undefined {
  const candidates = [
    join(import.meta.dirname, 'stt-sidecar.js'),
    join(import.meta.dirname, '../../out/main/stt-sidecar.js')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parseReadyLine(
  line: string
): { port: number; engine: SttEngineName; model: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (record.ready !== true || typeof record.port !== 'number') {
      return undefined;
    }
    const engine = record.engine === 'whisper' ? 'whisper' : 'mock';
    const model = typeof record.model === 'string' ? record.model : engine;
    return { port: record.port, engine, model };
  } catch {
    return undefined;
  }
}

export class VoiceBridge {
  private sidecar: SidecarHandle | undefined;
  private child: ChildProcess | undefined;
  private socket: WebSocket | undefined;
  private inProcess: InProcessStt | undefined;
  private live: LiveUtterance | undefined;
  private status: VoiceBridgeStatus = { engine: 'mock', model: 'mock-offline', fakeCapture: false };
  private pcmByUtterance = new Map<string, Buffer[]>();
  private starting: Promise<VoiceBridgeStatus> | undefined;
  private disposed = false;
  private capturing = false;
  private captureEpoch = 0;
  private stopping = false;
  private captureMode: VoiceMode = 'hold';
  private vad: VadState = createVadState();
  private utteranceSeq = 0;
  private pendingFinals: Promise<void>[] = [];
  private finalWaiters = new Map<string, () => void>();

  constructor(
    private readonly handlers: VoiceBridgeHandlers,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: { canCapture?: () => boolean } = {}
  ) {
    this.status.fakeCapture = env.SPYGLASS_VOICE_FAKE === '1' || env.CI === 'true';
  }

  snapshot(): VoiceBridgeStatus {
    return this.status;
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  /** Invalidate in-flight startCapture so a late resume cannot re-arm after Stop. */
  invalidateCapture(): void {
    this.captureEpoch += 1;
    this.capturing = false;
  }

  /** Fail-closed for new starts once Session Stop has begun (flush window). */
  beginStop(): void {
    this.stopping = true;
    this.invalidateCapture();
  }

  /** Next Record may arm the mic again. */
  resumeCapture(): void {
    this.stopping = false;
  }

  private allowsCapture(): boolean {
    if (this.stopping || this.disposed) {
      return false;
    }
    return this.options.canCapture?.() !== false;
  }

  async startCapture(mode: VoiceMode): Promise<VoiceBridgeStatus> {
    if (!this.allowsCapture()) {
      this.capturing = false;
      throw new Error('voice capture refused');
    }
    const epoch = this.captureEpoch;
    const status = await this.ensureStarted();
    if (this.captureEpoch !== epoch || !this.allowsCapture()) {
      this.capturing = false;
      throw new Error('voice capture refused');
    }
    this.capturing = true;
    this.captureMode = mode;
    this.vad = createVadState();
    return status;
  }

  setCaptureMode(mode: VoiceMode): void {
    if (this.captureMode === mode) {
      return;
    }
    if (this.live !== undefined) {
      if (this.pcmBytes(this.live.id) === 0) {
        this.dropUtterance(this.live.id);
      } else {
        this.endUtterance(Date.now());
      }
    }
    this.captureMode = mode;
    this.vad = createVadState();
  }

  async stopCapture(): Promise<void> {
    this.invalidateCapture();
    if (this.live !== undefined) {
      if (this.pcmBytes(this.live.id) === 0) {
        this.dropUtterance(this.live.id);
      } else {
        this.endUtterance(Date.now());
      }
    }
    this.vad = createVadState();
    await Promise.race([Promise.all(this.pendingFinals), sleep(parseVoiceFlushMs(this.env))]);
  }

  private nextUtteranceId(): string {
    this.utteranceSeq += 1;
    return `utt_${String(Date.now())}_${String(this.utteranceSeq)}`;
  }

  private preferInProcess(): boolean {
    if (this.env.SPYGLASS_STT_IN_PROCESS === '0') {
      return false;
    }
    if (this.env.SPYGLASS_STT_IN_PROCESS === '1' || this.env.CI === 'true') {
      return true;
    }
    return sidecarScriptPath() === undefined;
  }

  async ensureStarted(): Promise<VoiceBridgeStatus> {
    if (this.disposed) {
      throw new Error('STT bridge disposed');
    }
    if (this.inProcess !== undefined) {
      return this.status;
    }
    if (this.socket !== undefined && this.socket.readyState === WebSocket.OPEN) {
      return this.status;
    }
    if (this.starting !== undefined) {
      return await this.starting;
    }
    this.starting = this.connect();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async connect(): Promise<VoiceBridgeStatus> {
    await this.releaseSidecarTransport();
    if (this.preferInProcess()) {
      try {
        this.inProcess = await createInProcessSttFromEnv(this.env);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`STT in-process engine failed: ${detail}`);
      }
      this.status = {
        engine: this.inProcess.engine === 'whisper' ? 'whisper' : 'mock',
        model: this.inProcess.model,
        fakeCapture: this.env.SPYGLASS_VOICE_FAKE === '1' || this.env.CI === 'true'
      };
      return this.status;
    }
    const ready = await this.bootSidecar();
    this.status = {
      engine: ready.engine,
      model: ready.model,
      fakeCapture: this.env.SPYGLASS_VOICE_FAKE === '1' || this.env.CI === 'true'
    };
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(ready.port)}`);
      this.socket = ws;
      const timer = setTimeout(() => reject(new Error('STT sidecar WebSocket timeout')), 8_000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', sampleRate: STT_SAMPLE_RATE }));
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('STT sidecar WebSocket failed'));
      });
      ws.addEventListener('message', (event) => {
        this.onSocketMessage(event.data);
      });
    });
    return this.status;
  }

  /**
   * SIGTERM the sidecar so it can dispose the whisper engine (kill detached
   * whisper-cli grandchildren), then SIGKILL the process group. SIGKILL of
   * the Node child alone leaves whisper-cli running.
   */
  private async releaseSidecarTransport(): Promise<void> {
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = undefined;
    const closing = this.sidecar?.close();
    this.sidecar = undefined;
    const child = this.child;
    this.child = undefined;
    if (child !== undefined) {
      const pid = child.pid;
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([
          new Promise<void>((resolve) => {
            child.once('exit', () => {
              resolve();
            });
          }),
          sleep(400)
        ]);
      }
      if (pid !== undefined) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // already dead
          }
        }
      }
      child.unref();
    }
    if (closing !== undefined) {
      await closing.catch(() => undefined);
    }
  }

  private async bootSidecar(): Promise<{ port: number; engine: SttEngineName; model: string }> {
    await this.releaseSidecarTransport();
    const script = sidecarScriptPath();
    if (script === undefined) {
      this.sidecar = await startSidecarServer(this.env);
      return {
        port: this.sidecar.port,
        engine: this.sidecar.engine as SttEngineName,
        model: this.sidecar.model
      };
    }
    return await new Promise((resolve, reject) => {
      const childEnv: NodeJS.ProcessEnv = { ...this.env, ELECTRON_RUN_AS_NODE: '1' };
      const child = spawn(process.execPath, [script], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });
      this.child = child;
      let stdout = '';
      const timer = setTimeout(() => {
        try {
          if (child.pid !== undefined) {
            process.kill(-child.pid, 'SIGKILL');
          }
        } catch {
          child.kill('SIGKILL');
        }
        reject(new Error('STT sidecar did not become ready'));
      }, 10_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\n')) {
          const ready = parseReadyLine(line);
          if (ready !== undefined) {
            clearTimeout(timer);
            resolve(ready);
            return;
          }
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        console.error('[stt sidecar]', chunk.toString());
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        if (this.socket === undefined) {
          clearTimeout(timer);
          reject(new Error(`STT sidecar exited ${String(code ?? 'null')}`));
        }
      });
    });
  }

  beginUtterance(utteranceId: string, startTs: number): void {
    this.live = { id: utteranceId, startTs };
    if (!this.pcmByUtterance.has(utteranceId)) {
      this.pcmByUtterance.set(utteranceId, []);
    }
    if (this.inProcess !== undefined) {
      this.inProcess.begin(utteranceId, startTs);
      return;
    }
    this.socket?.send(JSON.stringify({ type: 'start', utteranceId, startTs }));
  }

  sendFrame(pcm: Buffer): void {
    if (!this.capturing) {
      return;
    }
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    if (this.captureMode === 'continuous') {
      const gate = gateVadUtterance(
        this.vad,
        samples,
        frameDurationMs(samples.length, STT_SAMPLE_RATE)
      );
      this.handlers.onLevel(gate.rms);
      if (gate.startUtterance) {
        this.beginUtterance(this.nextUtteranceId(), Date.now());
      }
      if (gate.sendFrame && this.live !== undefined) {
        this.deliverFrame(pcm);
      }
      if (gate.endUtterance) {
        this.endUtterance(Date.now());
      }
      return;
    }
    this.handlers.onLevel(pcmRms(samples));
    if (this.live === undefined) {
      this.beginUtterance(this.nextUtteranceId(), Date.now());
    }
    this.deliverFrame(pcm);
  }

  private deliverFrame(pcm: Buffer): void {
    const live = this.live;
    if (live === undefined) {
      return;
    }
    const chunks = this.pcmByUtterance.get(live.id);
    if (chunks === undefined) {
      this.pcmByUtterance.set(live.id, [pcm]);
    } else {
      chunks.push(pcm);
    }
    if (this.inProcess !== undefined) {
      this.inProcess.pushPcm(pcm, (text) => {
        this.handlers.onPartial({
          utteranceId: live.id,
          text,
          startTs: live.startTs
        });
      });
      return;
    }
    if (this.socket !== undefined && this.socket.readyState === WebSocket.OPEN) {
      const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
      this.socket.send(copy);
    }
  }

  endUtterance(endTs: number): void {
    const live = this.live;
    this.live = undefined;
    if (live === undefined) {
      return;
    }
    if (this.pcmBytes(live.id) === 0) {
      this.dropUtterance(live.id);
      return;
    }
    if (this.inProcess !== undefined) {
      const pcm = Buffer.concat(this.pcmByUtterance.get(live.id) ?? []);
      this.pcmByUtterance.delete(live.id);
      const work = this.inProcess.end(endTs).then(async (result) => {
        if (result === undefined || result.text.trim().length === 0) {
          return;
        }
        await this.handlers.onFinal({
          utteranceId: result.utteranceId,
          text: result.text,
          startTs: result.startTs,
          endTs: result.endTs,
          pcm
        });
      });
      this.trackFinal(work);
      return;
    }
    this.socket?.send(JSON.stringify({ type: 'end', utteranceId: live.id, endTs }));
    this.trackFinal(
      new Promise<void>((resolve) => {
        this.finalWaiters.set(live.id, resolve);
        setTimeout(resolve, parseVoiceFlushMs(this.env));
      })
    );
  }

  abort(): void {
    this.invalidateCapture();
    // An active flush (Stop of an already-armed utterance) must not be dropped.
    if (this.pendingFinals.length > 0) {
      return;
    }
    const live = this.live;
    this.live = undefined;
    this.vad = createVadState();
    if (live !== undefined) {
      this.pcmByUtterance.delete(live.id);
      this.resolveFinalWaiter(live.id);
    }
    this.inProcess?.abort();
    this.socket?.send(JSON.stringify({ type: 'abort' }));
    for (const resolve of this.finalWaiters.values()) {
      resolve();
    }
    this.finalWaiters.clear();
  }

  private dropUtterance(utteranceId: string): void {
    this.pcmByUtterance.delete(utteranceId);
    if (this.live?.id === utteranceId) {
      this.live = undefined;
    }
    this.resolveFinalWaiter(utteranceId);
    this.inProcess?.abort();
    this.socket?.send(JSON.stringify({ type: 'abort' }));
  }

  private trackFinal(work: Promise<void>): void {
    const tracked = work.then(
      () => undefined,
      () => undefined
    );
    this.pendingFinals.push(tracked);
    void tracked.finally(() => {
      this.pendingFinals = this.pendingFinals.filter((item) => item !== tracked);
    });
  }

  private resolveFinalWaiter(utteranceId: string): void {
    const resolve = this.finalWaiters.get(utteranceId);
    this.finalWaiters.delete(utteranceId);
    resolve?.();
  }

  private pcmBytes(utteranceId: string): number {
    const chunks = this.pcmByUtterance.get(utteranceId);
    if (chunks === undefined) {
      return 0;
    }
    return chunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.abort();
    this.inProcess?.dispose?.();
    this.inProcess = undefined;
    await this.releaseSidecarTransport();
  }

  private onSocketMessage(data: unknown): void {
    const text =
      typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    const message: ServerMessage | undefined = parseServerMessage(parsed);
    if (message === undefined) {
      return;
    }
    if (message.type === 'partial') {
      this.handlers.onPartial({
        utteranceId: message.utteranceId,
        text: message.text,
        startTs: message.startTs
      });
      return;
    }
    if (message.type === 'final') {
      const chunks = this.pcmByUtterance.get(message.utteranceId) ?? [];
      this.pcmByUtterance.delete(message.utteranceId);
      const pcm = Buffer.concat(chunks);
      if (pcm.length === 0 || message.text.trim().length === 0) {
        this.resolveFinalWaiter(message.utteranceId);
        return;
      }
      const journal = Promise.resolve(
        this.handlers.onFinal({
          utteranceId: message.utteranceId,
          text: message.text,
          startTs: message.startTs,
          endTs: message.endTs,
          pcm
        })
      );
      this.trackFinal(journal);
      void journal.finally(() => {
        this.resolveFinalWaiter(message.utteranceId);
      });
      return;
    }
    if (message.type === 'error') {
      this.handlers.onError(message.message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
