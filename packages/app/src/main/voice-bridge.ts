import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createInProcessStt,
  createVadState,
  frameDurationMs,
  gateVadUtterance,
  type InProcessStt,
  parseServerMessage,
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
  }) => void;
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
  private utterancePcm: Buffer[] = [];
  private starting: Promise<VoiceBridgeStatus> | undefined;
  private disposed = false;
  private captureMode: VoiceMode = 'hold';
  private vad: VadState = createVadState();
  private utteranceSeq = 0;

  constructor(
    private readonly handlers: VoiceBridgeHandlers,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.status.fakeCapture = env.SPYGLASS_VOICE_FAKE === '1' || env.CI === 'true';
  }

  snapshot(): VoiceBridgeStatus {
    return this.status;
  }

  async startCapture(mode: VoiceMode): Promise<VoiceBridgeStatus> {
    const status = await this.ensureStarted();
    this.captureMode = mode;
    this.vad = createVadState();
    if (mode === 'hold') {
      this.beginUtterance(this.nextUtteranceId(), Date.now());
    }
    return status;
  }

  stopCapture(): void {
    if (this.live !== undefined) {
      this.endUtterance(Date.now());
    }
    this.vad = createVadState();
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
    if (this.preferInProcess()) {
      this.inProcess = createInProcessStt(this.env);
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

  private async bootSidecar(): Promise<{ port: number; engine: SttEngineName; model: string }> {
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
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.child = child;
      let stdout = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
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
    this.utterancePcm = [];
    if (this.inProcess !== undefined) {
      this.inProcess.begin(utteranceId, startTs);
      return;
    }
    this.socket?.send(JSON.stringify({ type: 'start', utteranceId, startTs }));
  }

  sendFrame(pcm: Buffer): void {
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
      return;
    }
    this.deliverFrame(pcm);
  }

  private deliverFrame(pcm: Buffer): void {
    this.utterancePcm.push(pcm);
    const live = this.live;
    if (this.inProcess !== undefined && live !== undefined) {
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
    if (this.inProcess !== undefined) {
      const pcm = Buffer.concat(this.utterancePcm);
      this.utterancePcm = [];
      void this.inProcess.end(endTs).then((result) => {
        if (result === undefined) {
          return;
        }
        this.handlers.onFinal({
          utteranceId: result.utteranceId,
          text: result.text,
          startTs: result.startTs,
          endTs: result.endTs,
          pcm
        });
      });
      return;
    }
    this.socket?.send(JSON.stringify({ type: 'end', utteranceId: live.id, endTs }));
  }

  abort(): void {
    this.utterancePcm = [];
    this.live = undefined;
    this.vad = createVadState();
    this.inProcess?.abort();
    this.socket?.send(JSON.stringify({ type: 'abort' }));
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.abort();
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = undefined;
    if (this.child !== undefined) {
      this.child.kill('SIGKILL');
      this.child.unref();
      this.child = undefined;
    }
    const closing = this.sidecar?.close();
    this.sidecar = undefined;
    this.inProcess = undefined;
    if (closing === undefined) {
      return;
    }
    await Promise.race([closing.catch(() => undefined), sleep(400)]);
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
      const pcm = Buffer.concat(this.utterancePcm);
      this.utterancePcm = [];
      this.handlers.onFinal({
        utteranceId: message.utteranceId,
        text: message.text,
        startTs: message.startTs,
        endTs: message.endTs,
        pcm
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
