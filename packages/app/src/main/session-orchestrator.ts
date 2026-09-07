import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawEvent } from '@spyglass/contracts';
import {
  CLICK_CHANGE_WINDOW_MS,
  isDenoisedClickForChange,
  NET_CORRELATION_MS,
  type ProbeElementDescriptor,
  SCREENSHOT_JPEG_QUALITY,
  SCREENSHOT_RETENTION,
  snapshotScript
} from '@spyglass/probe';
import type { NavState, RecorderState } from '../shared/ipc.ts';
import type { BrowserPane } from './browser-pane.ts';
import {
  asProbeWireEvent,
  buildControlEvent,
  buildRawEvent,
  isCaptureStepKind,
  type ProbeWireEvent,
  redactNetRequestUrl
} from './capture-pipeline.ts';
import { ProbeHost } from './probe-host.ts';
import { parseJsonl, RawJournal } from './raw-journal.ts';
import { CaptureRetention } from './retention.ts';
import { formatEventId, newProbeNonce, newSessionId } from './session-ids.ts';

export type { RecorderState };

export type SessionMeta = {
  sessionId: string;
  startedAt: string;
  startUrl: string;
  schemaVersion: 1;
  toolVersion: string;
  eventCount: number;
  sealedAt?: string;
};

export type SessionOrchestratorHandlers = {
  onEvent: (event: RawEvent) => void;
  onState: (state: { state: RecorderState; since: number; sessionId?: string }) => void;
};

type PendingClick = {
  wire: ProbeWireEvent;
  target: ProbeElementDescriptor;
  ts: number;
};

export class SessionOrchestrator {
  private state: RecorderState = 'idle';
  private since = Date.now();
  private sessionId: string | undefined;
  private sessionDir: string | undefined;
  private journal: RawJournal | undefined;
  private retention: CaptureRetention | undefined;
  private eventSeq = 0;
  private stepIndex = 0;
  private sessionStartedAt = '';
  private sessionStartUrl = '';
  private lastDom: { kind: string; ts: number; target: ProbeElementDescriptor } | undefined;
  private lastUserActionTs = 0;
  private readonly seenEventIds = new Set<string>();
  private probe: ProbeHost | undefined;
  private readonly probeNonce = newProbeNonce();
  private writeChain: Promise<void> = Promise.resolve();
  private pendingClick: PendingClick | undefined;
  private pendingClickTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly sessionsRoot: () => string,
    private readonly pane: () => BrowserPane,
    private readonly handlers: SessionOrchestratorHandlers
  ) {}

  snapshot(): { state: RecorderState; since: number; sessionId?: string } {
    const result: { state: RecorderState; since: number; sessionId?: string } = {
      state: this.state,
      since: this.since
    };
    if (this.sessionId !== undefined) {
      result.sessionId = this.sessionId;
    }
    return result;
  }

  attachProbe(): void {
    const contents = this.pane().webContents;
    this.probe = new ProbeHost(contents, this.probeNonce, {
      onProbeEvent: (payload) => {
        void this.enqueueWrite(() => this.processProbePayload(payload));
      }
    });
    this.probe.attach();
  }

  async start(startUrl: string): Promise<{ sessionId: string }> {
    if (this.state === 'recording') {
      if (this.sessionId === undefined) {
        throw new Error('Recording without session id');
      }
      return { sessionId: this.sessionId };
    }
    if (this.state !== 'idle' && this.state !== 'sealed') {
      throw new Error(`Cannot start recording from ${this.state}`);
    }
    const sessionId = newSessionId();
    const sessionDir = join(this.sessionsRoot(), sessionId);
    await mkdir(sessionDir, { recursive: true });
    const journal = new RawJournal(join(sessionDir, 'raw.jsonl'));
    await journal.recover();
    const retention = new CaptureRetention(sessionDir, {
      screenshotLimit: screenshotLimitFromEnv()
    });
    await retention.init();
    const meta: SessionMeta = {
      sessionId,
      startedAt: new Date().toISOString(),
      startUrl,
      schemaVersion: 1,
      toolVersion: '0.0.0',
      eventCount: 0
    };
    await writeFile(join(sessionDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
    this.journal = journal;
    this.retention = retention;
    this.eventSeq = 0;
    this.stepIndex = 0;
    this.sessionStartedAt = meta.startedAt;
    this.sessionStartUrl = startUrl;
    this.seenEventIds.clear();
    this.lastDom = undefined;
    this.discardPendingClick();
    this.state = 'recording';
    this.since = Date.now();
    await this.enqueueWrite(async () => {
      const page = this.pageSnapshot();
      const id = this.nextId();
      await this.append(
        buildControlEvent({
          id,
          sessionId,
          kind: 'record.start',
          ts: Date.now(),
          page
        })
      );
    });
    await this.probe?.injectTree();
    this.emitState();
    return { sessionId };
  }

  async stop(): Promise<{ sessionId: string; eventCount: number; sizeBytes: number }> {
    if (this.state === 'sealed-failed') {
      return await this.repairSeal();
    }
    if (this.state !== 'recording' || this.sessionId === undefined || this.journal === undefined) {
      throw new Error('Not recording');
    }
    const sessionId = this.sessionId;
    const journal = this.journal;
    await this.enqueueWrite(async () => {
      if (this.state !== 'recording') {
        return;
      }
      await this.probe?.flushPendingInputs();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return await this.enqueueWrite(async () => {
      if (this.state === 'sealed') {
        const raw = await readFile(journal.path, 'utf8');
        return {
          sessionId,
          eventCount: parseJsonl(raw).length,
          sizeBytes: Buffer.byteLength(raw)
        };
      }
      if (this.state === 'sealed-failed') {
        try {
          return await this.forceSeal(sessionId, journal);
        } catch (error) {
          this.enterSealedFailed();
          throw wrapSealFailure(error);
        }
      }
      if (
        this.state !== 'recording' ||
        this.sessionId === undefined ||
        this.journal === undefined
      ) {
        throw new Error('Not recording');
      }
      this.state = 'stopping';
      this.emitState();
      let durableStop = false;
      try {
        const existingRaw = await readFile(journal.path, 'utf8');
        const existingStops = countRecordStop(parseJsonl(existingRaw));
        if (existingStops > 0) {
          durableStop = true;
          if (existingStops > 1) {
            throw new Error('Cannot stop: journal already has multiple record.stop events');
          }
        } else {
          await this.flushPendingClick();
          const page = this.pageSnapshot();
          const id = this.nextId();
          await this.append(
            buildControlEvent({
              id,
              sessionId,
              kind: 'record.stop',
              ts: Date.now(),
              page
            })
          );
          durableStop = true;
        }
        return await this.forceSeal(sessionId, journal);
      } catch (error) {
        if (!durableStop) {
          this.state = 'recording';
          this.since = Date.now();
          this.emitState();
          throw error;
        }
        this.enterSealedFailed();
        throw wrapSealFailure(error);
      }
    });
  }

  async retract(eventId: string): Promise<{ retractedEventId: string }> {
    if (this.state !== 'recording' || this.sessionId === undefined) {
      throw new Error('Retraction requires an active recording');
    }
    return await this.enqueueWrite(async () => {
      if (this.state !== 'recording' || this.sessionId === undefined) {
        throw new Error('Retraction requires an active recording');
      }
      await this.flushPendingClick();
      if (!this.seenEventIds.has(eventId) && !(await this.eventExists(eventId))) {
        throw new Error(`Unknown event ${eventId}`);
      }
      const id = this.nextId();
      await this.append(
        buildControlEvent({
          id,
          sessionId: this.sessionId,
          kind: 'step.retracted',
          ts: Date.now(),
          page: this.pageSnapshot(),
          retracts: eventId
        })
      );
      return { retractedEventId: eventId };
    });
  }

  async recordNav(kind: RawEvent['kind'], page?: NavState): Promise<void> {
    await this.enqueueWrite(async () => {
      if (this.state !== 'recording' || this.sessionId === undefined) {
        return;
      }
      await this.flushPendingClick();
      const id = this.nextId();
      await this.append(
        buildControlEvent({
          id,
          sessionId: this.sessionId,
          kind,
          ts: Date.now(),
          page: page ?? this.pageSnapshot()
        })
      );
    });
  }

  async recordPopup(url: string): Promise<void> {
    await this.enqueueWrite(async () => {
      if (this.state !== 'recording' || this.sessionId === undefined) {
        return;
      }
      await this.flushPendingClick();
      const id = this.nextId();
      await this.append(
        buildControlEvent({
          id,
          sessionId: this.sessionId,
          kind: 'nav.popup-redirected',
          ts: Date.now(),
          page: { url, title: this.pane().snapshot().title }
        })
      );
    });
  }

  async recordNetRequest(url: string): Promise<void> {
    await this.enqueueWrite(async () => {
      if (this.state !== 'recording' || this.sessionId === undefined) {
        return;
      }
      if (Date.now() - this.lastUserActionTs > NET_CORRELATION_MS) {
        return;
      }
      const id = this.nextId();
      await this.append(
        buildControlEvent({
          id,
          sessionId: this.sessionId,
          kind: 'net.request',
          ts: Date.now(),
          page: { url: redactNetRequestUrl(url), title: this.pane().snapshot().title }
        })
      );
    });
  }

  currentSessionDir(): string | undefined {
    return this.sessionDir;
  }

  currentSessionId(): string | undefined {
    return this.sessionId;
  }

  async readRawEvents(): Promise<RawEvent[]> {
    if (this.journal === undefined) {
      return [];
    }
    const raw = await readFile(this.journal.path, 'utf8');
    return parseJsonl(raw) as RawEvent[];
  }

  async flushPendingCapture(): Promise<void> {
    await this.enqueueWrite(async () => {
      if (this.state !== 'recording') {
        return;
      }
      await this.flushPendingClick();
    });
  }

  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private discardPendingClick(): void {
    if (this.pendingClickTimer !== undefined) {
      clearTimeout(this.pendingClickTimer);
      this.pendingClickTimer = undefined;
    }
    this.pendingClick = undefined;
  }

  private schedulePendingClickFlush(): void {
    if (this.pendingClickTimer !== undefined) {
      clearTimeout(this.pendingClickTimer);
    }
    this.pendingClickTimer = setTimeout(() => {
      this.pendingClickTimer = undefined;
      void this.enqueueWrite(async () => {
        await this.flushPendingClick();
      });
    }, CLICK_CHANGE_WINDOW_MS);
  }

  private async flushPendingClick(): Promise<void> {
    const pending = this.pendingClick;
    if (this.pendingClickTimer !== undefined) {
      clearTimeout(this.pendingClickTimer);
      this.pendingClickTimer = undefined;
    }
    this.pendingClick = undefined;
    if (pending === undefined || this.sessionId === undefined) {
      return;
    }
    await this.commitProbeEvent(pending.wire);
  }

  private pendingMatchesChange(wire: {
    kind: string;
    ts: number;
    target?: ProbeElementDescriptor;
  }): boolean {
    if (this.pendingClick === undefined || wire.target === undefined) {
      return false;
    }
    return isDenoisedClickForChange(
      'dom.click',
      wire.kind,
      this.pendingClick.target,
      wire.target,
      this.pendingClick.ts,
      wire.ts
    );
  }

  private async processProbePayload(payload: unknown): Promise<void> {
    if (this.state !== 'recording' || this.sessionId === undefined) {
      return;
    }
    const wire = asProbeWireEvent(payload);
    if (wire === undefined) {
      return;
    }

    if (this.pendingMatchesChange(wire)) {
      this.discardPendingClick();
    } else if (wire.kind !== 'dom.click') {
      await this.flushPendingClick();
    } else if (this.pendingClick !== undefined) {
      await this.flushPendingClick();
    }

    if (
      this.lastDom !== undefined &&
      wire.target !== undefined &&
      wire.kind === 'dom.click' &&
      isDenoisedClickForChange(
        wire.kind,
        this.lastDom.kind,
        wire.target,
        this.lastDom.target,
        this.lastDom.ts,
        wire.ts
      )
    ) {
      return;
    }

    if (wire.kind === 'dom.click' && wire.target !== undefined) {
      this.pendingClick = { wire, target: wire.target, ts: wire.ts };
      this.schedulePendingClickFlush();
      return;
    }
    await this.commitProbeEvent(wire);
  }

  private async commitProbeEvent(wire: ProbeWireEvent): Promise<void> {
    if (this.sessionId === undefined) {
      return;
    }
    const id = this.nextId();
    let step: number | undefined;
    if (isCaptureStepKind(wire.kind)) {
      this.stepIndex += 1;
      step = this.stepIndex;
      this.lastUserActionTs = wire.ts;
      if (wire.target !== undefined) {
        this.lastDom = { kind: wire.kind, ts: wire.ts, target: wire.target };
      }
    }
    let snapshotRef: string | undefined;
    let screenshotRef: string | undefined;
    if (step !== undefined && this.retention !== undefined) {
      snapshotRef = await this.captureSnapshot(step);
      screenshotRef = await this.captureScreenshot(step);
      if (snapshotRef === undefined || screenshotRef === undefined) {
        this.retention.pinFailure(step);
      }
    }
    await this.append(
      buildRawEvent({
        id,
        sessionId: this.sessionId,
        wire,
        stepIndex: step,
        snapshotRef,
        screenshotRef,
        pageFallback: this.pageSnapshot()
      })
    );
  }

  private async captureSnapshot(stepIndex: number): Promise<string | undefined> {
    if (this.retention === undefined) {
      return undefined;
    }
    try {
      const frame = this.pane().webContents.mainFrame;
      const raw: unknown = await frame.executeJavaScript(snapshotScript(['main']), false);
      return await this.retention.writeSnapshot(stepIndex, raw);
    } catch {
      return undefined;
    }
  }

  private async captureScreenshot(stepIndex: number): Promise<string | undefined> {
    if (this.retention === undefined) {
      return undefined;
    }
    try {
      const image = await this.pane().webContents.capturePage();
      const jpeg = image.toJPEG(SCREENSHOT_JPEG_QUALITY);
      return await this.retention.writeScreenshot(stepIndex, Buffer.from(jpeg));
    } catch {
      return undefined;
    }
  }

  private async append(event: RawEvent): Promise<void> {
    if (this.journal === undefined) {
      return;
    }
    if (this.state === 'sealed' || this.state === 'sealed-failed') {
      return;
    }
    await this.journal.append(event);
    this.seenEventIds.add(event.id);
    this.handlers.onEvent(event);
  }

  private enterSealedFailed(): void {
    this.state = 'sealed-failed';
    this.since = Date.now();
    this.emitState();
  }

  private async repairSeal(): Promise<{
    sessionId: string;
    eventCount: number;
    sizeBytes: number;
  }> {
    if (this.sessionId === undefined || this.journal === undefined) {
      throw new Error('No session to seal');
    }
    const sessionId = this.sessionId;
    const journal = this.journal;
    this.state = 'stopping';
    this.emitState();
    return await this.enqueueWrite(async () => {
      try {
        return await this.forceSeal(sessionId, journal);
      } catch (error) {
        this.enterSealedFailed();
        throw wrapSealFailure(error);
      }
    });
  }

  private async forceSeal(
    sessionId: string,
    journal: RawJournal
  ): Promise<{ sessionId: string; eventCount: number; sizeBytes: number }> {
    const raw = await readFile(journal.path, 'utf8');
    const events = parseJsonl(raw);
    const stops = countRecordStop(events);
    if (stops === 0) {
      throw new Error('Cannot seal: journal has no record.stop');
    }
    if (stops > 1) {
      throw new Error('Cannot seal: journal has multiple record.stop events');
    }
    const eventCount = events.length;
    const sealedAt = new Date().toISOString();
    try {
      await this.writeSealMeta(eventCount, sealedAt);
    } catch {
      await this.writeSealMeta(eventCount, sealedAt);
    }
    this.state = 'sealed';
    this.since = Date.now();
    this.emitState();
    return { sessionId, eventCount, sizeBytes: Buffer.byteLength(raw) };
  }

  private nextId(): string {
    this.eventSeq += 1;
    return formatEventId(this.eventSeq);
  }

  private pageSnapshot(): { url: string; title: string } {
    const snap = this.pane().snapshot();
    return { url: snap.url, title: snap.title };
  }

  private emitState(): void {
    this.handlers.onState(this.snapshot());
  }

  private async eventExists(eventId: string): Promise<boolean> {
    const events = await this.readRawEvents();
    return events.some((event) => event.id === eventId);
  }

  private buildSealMeta(eventCount: number, sealedAt: string): SessionMeta {
    return {
      sessionId: this.sessionId ?? '',
      startedAt: this.sessionStartedAt,
      startUrl: this.sessionStartUrl,
      schemaVersion: 1,
      toolVersion: '0.0.0',
      eventCount,
      sealedAt
    };
  }

  private async writeSealMeta(eventCount: number, sealedAt: string): Promise<void> {
    if (this.sessionDir === undefined) {
      throw new Error('Cannot write session meta: no session directory');
    }
    const path = join(this.sessionDir, 'meta.json');
    const rebuilt = this.buildSealMeta(eventCount, sealedAt);
    let meta = rebuilt;
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const current = parsed as Partial<SessionMeta>;
        meta = {
          ...rebuilt,
          startedAt:
            typeof current.startedAt === 'string' && current.startedAt.length > 0
              ? current.startedAt
              : rebuilt.startedAt,
          startUrl:
            typeof current.startUrl === 'string' && current.startUrl.length > 0
              ? current.startUrl
              : rebuilt.startUrl,
          toolVersion:
            typeof current.toolVersion === 'string' && current.toolVersion.length > 0
              ? current.toolVersion
              : rebuilt.toolVersion,
          eventCount,
          sealedAt
        };
      }
    } catch {
      // missing or corrupt JSON — write a full rebuilt meta, not a sealedAt-only patch
    }
    await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
}

function isRecordStopEvent(event: unknown): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as { kind?: unknown }).kind === 'record.stop'
  );
}

function countRecordStop(events: unknown[]): number {
  return events.filter(isRecordStopEvent).length;
}

function wrapSealFailure(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Stop failed: record.stop is in the journal but meta.json could not be sealed (${detail}). Retry Stop to repair meta.`
  );
}

export function screenshotLimitFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SCREENSHOT_RETENTION;
  if (raw === undefined || raw.length === 0) {
    return SCREENSHOT_RETENTION;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : SCREENSHOT_RETENTION;
}

export function sessionsDirFromEnv(userData: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SESSIONS_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(userData, 'sessions');
}
