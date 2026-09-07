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

function frameSelector(frame: WebFrameMain, isRoot: boolean): string {
  if (isRoot) {
    return 'main';
  }
  if (frame.name.length > 0) {
    if (/^[A-Za-z_][\w-]*$/.test(frame.name)) {
      return `iframe#${frame.name}`;
    }
    return `iframe[name="${frame.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
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
    this.injectTree();
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.contents.off('console-message', this.onConsole);
    this.contents.off('did-frame-finish-load', this.onFrameLoad);
  }

  private readonly onConsole = (
    details: { message?: string },
    _level?: number,
    message?: string
  ): void => {
    const text = message ?? details.message ?? '';
    const prefix = `${PROBE_CONSOLE_PREFIX}${this.nonce}:`;
    if (!text.startsWith(prefix)) {
      return;
    }
    const raw = text.slice(prefix.length);
    try {
      const payload: unknown = JSON.parse(raw);
      this.handlers.onProbeEvent(payload, ['main']);
    } catch {
      // ignore malformed probe lines
    }
  };

  private readonly onFrameLoad = (
    _event: Electron.Event,
    _isMainFrame: boolean,
    frameProcessId: number,
    frameRoutingId: number
  ): void => {
    const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
    if (frame !== undefined && !frame.isDestroyed()) {
      void this.injectFrame(frame);
    }
  };

  injectTree(): void {
    const main = this.contents.mainFrame;
    void this.injectFrame(main);
    for (const frame of main.framesInSubtree) {
      void this.injectFrame(frame);
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
    } catch {
      // frame may have navigated away
    }
  }
}
