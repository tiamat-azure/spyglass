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
}
