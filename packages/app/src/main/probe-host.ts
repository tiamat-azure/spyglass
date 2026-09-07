import {
  buildProbeSource,
  INPUT_AGGREGATION_MS,
  PROBE_CONSOLE_PREFIX,
  SCROLL_THRESHOLD_PX
} from '@spyglass/probe';
import type { WebContents, WebFrameMain } from 'electron';
import { webFrameMain } from 'electron';

export type ProbeHostHandlers = {
  onProbeEvent: (payload: unknown, framePath: string[]) => void;
};

/** Electron `WebFrameMain.name` is the frame name, not the element id. Never `#`. */
export function iframeNameSelector(name: string): string {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
  return `iframe[name="${escaped}"]`;
}

function frameSelector(frame: WebFrameMain, isRoot: boolean): string {
  if (isRoot) {
    return 'main';
  }
  if (frame.name.length > 0) {
    return iframeNameSelector(frame.name);
  }
  try {
    const url = new URL(frame.url);
    const file = url.pathname.split('/').pop();
    if (file !== undefined && file.length > 0) {
      return `iframe[src*="${file}"]`;
    }
  } catch {
    // ignore
  }
  return 'iframe';
}

export function describeFramePath(frame: WebFrameMain): string[] {
  const chain: WebFrameMain[] = [];
  let current: WebFrameMain | undefined = frame;
  while (current) {
    chain.unshift(current);
    current = current.parent ?? undefined;
  }
  return chain.map((item, index) => frameSelector(item, index === 0));
}

export function consoleMessageText(details: { message?: string }, message?: string): string {
  if (typeof details.message === 'string' && details.message.length > 0) {
    return details.message;
  }
  if (typeof message === 'string') {
    return message;
  }
  return '';
}

export class ProbeHost {
  private readonly nonce: string;
  private attached = false;

  constructor(
    private readonly contents: WebContents,
    nonce: string,
    private readonly handlers: ProbeHostHandlers
  ) {
    this.nonce = nonce;
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.contents.on('console-message', this.onConsole);
    this.contents.on('did-frame-finish-load', this.onFrameLoad);
    this.contents.on('did-finish-load', this.onMainLoad);
    this.contents.on('dom-ready', this.onMainLoad);
    void this.injectTree();
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.contents.off('console-message', this.onConsole);
    this.contents.off('did-frame-finish-load', this.onFrameLoad);
    this.contents.off('did-finish-load', this.onMainLoad);
    this.contents.off('dom-ready', this.onMainLoad);
  }

  private readonly onConsole = (
    details: { message?: string; frame?: WebFrameMain },
    _level?: number,
    message?: string
  ): void => {
    const text = consoleMessageText(details, message);
    const prefix = `${PROBE_CONSOLE_PREFIX}${this.nonce}:`;
    if (!text.startsWith(prefix)) {
      return;
    }
    const raw = text.slice(prefix.length);
    try {
      const payload: unknown = JSON.parse(raw);
      const framePath =
        details.frame !== undefined && !details.frame.isDestroyed()
          ? describeFramePath(details.frame)
          : ['main'];
      this.handlers.onProbeEvent(payload, framePath);
    } catch {
      // ignore malformed probe lines
    }
  };

  private readonly onMainLoad = (): void => {
    void this.injectTree();
  };

  private readonly onFrameLoad = (
    event: Electron.Event & {
      isMainFrame?: boolean;
      frameProcessId?: number;
      frameRoutingId?: number;
    },
    isMainFrame?: boolean,
    frameProcessId?: number,
    frameRoutingId?: number
  ): void => {
    const pid = frameProcessId ?? event.frameProcessId;
    const rid = frameRoutingId ?? event.frameRoutingId;
    if (typeof pid === 'number' && typeof rid === 'number') {
      const frame = webFrameMain.fromId(pid, rid);
      if (frame !== undefined && !frame.isDestroyed()) {
        void this.injectFrame(frame);
        return;
      }
    }
    void this.injectTree();
    void isMainFrame;
  };

  async injectTree(): Promise<void> {
    const jobs: Array<Promise<void>> = [this.injectMainViaContents()];
    try {
      const main = this.contents.mainFrame;
      jobs.push(this.injectFrame(main));
      for (const frame of main.framesInSubtree) {
        jobs.push(this.injectFrame(frame));
      }
    } catch {
      // mainFrame may be unavailable during navigation
    }
    await Promise.all(jobs);
  }

  private async injectMainViaContents(): Promise<void> {
    if (this.contents.isDestroyed()) {
      return;
    }
    const source = buildProbeSource({
      nonce: this.nonce,
      inputAggregationMs: INPUT_AGGREGATION_MS,
      scrollThresholdPx: SCROLL_THRESHOLD_PX,
      framePath: ['main']
    });
    try {
      await this.contents.executeJavaScript(source, false);
    } catch (error) {
      console.error('[spyglass] probe inject (main) failed', error);
    }
  }

  private async injectFrame(frame: WebFrameMain): Promise<void> {
    if (frame.isDestroyed()) {
      return;
    }
    const source = buildProbeSource({
      nonce: this.nonce,
      inputAggregationMs: INPUT_AGGREGATION_MS,
      scrollThresholdPx: SCROLL_THRESHOLD_PX,
      framePath: describeFramePath(frame)
    });
    try {
      await frame.executeJavaScript(source, false);
    } catch (error) {
      console.error('[spyglass] probe inject failed', frame.url, error);
    }
  }

  /**
   * Synchronous evaluate drain: returns pending input payloads from the page
   * world. Does not emit via console.log. Main frame is required (missing hook
   * fails Stop after one reinject). Child frames are skipped on execute failure.
   */
  async drainPendingInputs(): Promise<unknown[]> {
    if (this.contents.isDestroyed()) {
      throw new Error('Cannot stop: guest webContents destroyed');
    }
    const first = await this.drainFrameExecute(
      () => this.contents.executeJavaScript(DRAIN_PENDING_SOURCE, false),
      { required: false, label: 'main' }
    );
    let mainEvents: unknown[];
    if (first.ok) {
      mainEvents = first.events;
    } else {
      await this.injectTree();
      mainEvents = (
        await this.drainFrameExecute(
          () => this.contents.executeJavaScript(DRAIN_PENDING_SOURCE, false),
          { required: true, label: 'main' }
        )
      ).events;
    }
    const childEvents = await this.drainChildFrames();
    return [...mainEvents, ...childEvents];
  }

  private async drainChildFrames(): Promise<unknown[]> {
    const events: unknown[] = [];
    try {
      const main = this.contents.mainFrame;
      for (const frame of main.framesInSubtree) {
        if (frame === main || frame.isDestroyed()) {
          continue;
        }
        const drained = await this.drainFrameExecute(
          () => frame.executeJavaScript(DRAIN_PENDING_SOURCE, false),
          { required: false, label: describeFramePath(frame).join(' >> ') }
        );
        if (drained.ok) {
          events.push(...drained.events);
        }
      }
    } catch {
      // mainFrame may be unavailable during navigation
    }
    return events;
  }

  private async drainFrameExecute(
    exec: () => Promise<unknown>,
    opts: { required: boolean; label: string }
  ): Promise<{ ok: true; events: unknown[] } | { ok: false; events: [] }> {
    let raw: unknown;
    try {
      raw = await exec();
    } catch (error) {
      if (opts.required) {
        throw new Error(
          `Cannot stop: probe flush failed (${opts.label}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return { ok: false, events: [] };
    }
    const parsed = parseDrainResult(raw, opts.label);
    if (parsed.ok) {
      return parsed;
    }
    if (opts.required) {
      throw new Error(`Cannot stop: ${parsed.error}`);
    }
    return { ok: false, events: [] };
  }
}

const DRAIN_PENDING_SOURCE = `(() => {
  try {
    const fn = window[Symbol.for('spyglass.probe.flush')];
    if (typeof fn !== 'function') {
      return { ok: false, error: 'probe flush hook missing' };
    }
    const events = fn();
    if (!Array.isArray(events)) {
      return { ok: false, error: 'probe flush hook did not return events' };
    }
    return { ok: true, eventsJson: JSON.stringify(events) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
})()`;

function parseDrainResult(
  raw: unknown,
  label: string
): { ok: true; events: unknown[] } | { ok: false; error: string; events: [] } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: `probe flush returned invalid result (${label})`, events: [] };
  }
  const result = raw as { ok?: unknown; eventsJson?: unknown; error?: unknown };
  if (result.ok !== true) {
    const error =
      typeof result.error === 'string' && result.error.length > 0
        ? result.error
        : 'probe flush hook missing';
    return { ok: false, error, events: [] };
  }
  if (typeof result.eventsJson !== 'string') {
    return { ok: false, error: `probe flush events missing (${label})`, events: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.eventsJson);
  } catch {
    return { ok: false, error: `probe flush events not JSON (${label})`, events: [] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: `probe flush events not an array (${label})`, events: [] };
  }
  return { ok: true, events: parsed };
}
