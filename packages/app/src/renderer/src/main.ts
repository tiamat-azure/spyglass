import type { NavState, SessionStatePayload, StagehandObserveResponse } from '../../shared/ipc.ts';
import { DEFAULT_SPLIT_RATIO } from '../../shared/ipc.ts';

const CHAT_MIN_PX = 300;
const GUTTER_PX = 8;
const BROWSER_MIN_PX = 240;

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

function clampRatio(ratio: number, bodyWidth: number): number {
  if (!Number.isFinite(ratio) || bodyWidth <= 0) {
    return DEFAULT_SPLIT_RATIO;
  }
  const minRatio = BROWSER_MIN_PX / bodyWidth;
  const maxRatio = Math.max(minRatio, (bodyWidth - CHAT_MIN_PX - GUTTER_PX) / bodyWidth);
  return Math.min(maxRatio, Math.max(minRatio, ratio));
}

function applyRatio(browserSlot: HTMLElement, ratio: number): void {
  browserSlot.style.flexBasis = `${String(ratio * 100)}%`;
}

function appendLog(log: HTMLOListElement, text: string): void {
  const item = document.createElement('li');
  item.textContent = text;
  log.append(item);
  log.scrollTop = log.scrollHeight;
}

function formatObservations(result: StagehandObserveResponse): string {
  if (!result.ok) {
    return `observe failed: ${result.error ?? 'unknown error'}`;
  }
  if (result.observations.length === 0) {
    return `observe ok (${result.model ?? 'stub'}) — no elements`;
  }
  const lines = result.observations.slice(0, 8).map((obs, index) => {
    const label = obs.description ?? obs.selector ?? `element ${String(index + 1)}`;
    const method = obs.method ?? '';
    return `${String(index + 1)}. ${method} ${label}`.trim();
  });
  return `observe ok (${result.model ?? 'stub'})\n${lines.join('\n')}`;
}

const api = window.spyglass;
const toolbar = requireEl<HTMLElement>('toolbar');
const urlInput = requireEl<HTMLInputElement>('url');
const urlForm = requireEl<HTMLFormElement>('url-form');
const backBtn = requireEl<HTMLButtonElement>('back');
const forwardBtn = requireEl<HTMLButtonElement>('forward');
const reloadBtn = requireEl<HTMLButtonElement>('reload');
const browserSlot = requireEl<HTMLElement>('browser-slot');
const workspace = requireEl<HTMLElement>('workspace');
const gutter = requireEl<HTMLElement>('gutter');
const versions = requireEl<HTMLElement>('versions');
const cdpStatus = requireEl<HTMLElement>('cdp-status');
const observeBtn = requireEl<HTMLButtonElement>('observe');
const recordBtn = requireEl<HTMLButtonElement>('record-btn');
const replayActBtn = requireEl<HTMLButtonElement>('replay-act');
const recPill = requireEl<HTMLElement>('rec-pill');
const log = requireEl<HTMLOListElement>('log');

if (api === undefined) {
  versions.textContent = 'preload bridge unavailable';
} else {
  versions.textContent = `Electron ${api.versions.electron} · Chromium ${api.versions.chrome} · Node ${api.versions.node} · lot ${api.lot}`;
}

let splitRatio = DEFAULT_SPLIT_RATIO;
applyRatio(browserSlot, splitRatio);

function reportBounds(): void {
  if (api === undefined) {
    return;
  }
  const rect = browserSlot.getBoundingClientRect();
  api.layout.setBrowserBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });
}

const resizeObserver = new ResizeObserver(() => {
  reportBounds();
});
resizeObserver.observe(browserSlot);
reportBounds();

if (api !== undefined) {
  api.nav.onState((state: NavState) => {
    if (document.activeElement !== urlInput) {
      urlInput.value = state.url;
    }
    toolbar.dataset.loading = state.loading ? 'true' : 'false';
    backBtn.disabled = !state.canGoBack;
    forwardBtn.disabled = !state.canGoForward;
  });

  api.nav.onPopupRedirected((payload) => {
    appendLog(log, `nav.popup-redirected ${payload.url}`);
  });

  api.stagehand.onResult((result) => {
    appendLog(log, formatObservations(result));
  });

  api.session.onState((state: SessionStatePayload) => {
    const recording = state.state === 'recording';
    recordBtn.dataset.state = recording ? 'recording' : 'idle';
    recordBtn.textContent = recording ? 'Stop' : 'Record';
    recPill.dataset.active = recording ? 'true' : 'false';
    recPill.title = recording ? 'Recording' : 'Recording idle';
    browserSlot.dataset.recording = recording ? 'true' : 'false';
  });

  api.session.onEvent((event) => {
    const kind = typeof event.kind === 'string' ? event.kind : 'event';
    const id = typeof event.id === 'string' ? event.id : '';
    const narration =
      typeof event.narration === 'object' &&
      event.narration !== null &&
      typeof (event.narration as { text?: unknown }).text === 'string'
        ? (event.narration as { text: string }).text
        : kind;
    const item = document.createElement('li');
    item.dataset.eventId = id;
    const label = document.createElement('span');
    label.textContent = `${kind} · ${narration}`;
    item.append(label);
    if (kind.startsWith('dom.') && id.length > 0) {
      const retract = document.createElement('button');
      retract.type = 'button';
      retract.className = 'retract';
      retract.textContent = 'Retract';
      retract.addEventListener('click', () => {
        void api.session.retract(id);
      });
      item.append(retract);
    }
    if (kind === 'step.retracted' && typeof event.retracts === 'string') {
      const previous = log.querySelector(`[data-event-id="${event.retracts}"]`);
      if (previous instanceof HTMLElement) {
        previous.dataset.retracted = 'true';
      }
    }
    log.append(item);
    log.scrollTop = log.scrollHeight;
  });

  void api.stagehand.cdp().then((info) => {
    if (info.port <= 0 || info.cdpUrl.length === 0) {
      cdpStatus.textContent = 'CDP off — set SPYGLASS_CDP=1';
      return;
    }
    const target = info.targetId === undefined ? 'resolving' : info.targetId.slice(0, 8);
    cdpStatus.textContent = `CDP ${info.cdpUrl} · target ${target}`;
  });
}

urlForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (api === undefined) {
    return;
  }
  void api.nav.goto(urlInput.value).then((result) => {
    if (!result.ok) {
      appendLog(log, `goto failed: ${result.error}`);
    }
  });
});

backBtn.addEventListener('click', () => {
  void api?.nav.back();
});
forwardBtn.addEventListener('click', () => {
  void api?.nav.forward();
});
reloadBtn.addEventListener('click', () => {
  void api?.nav.reload();
});

observeBtn.addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  observeBtn.disabled = true;
  void api.stagehand
    .observe()
    .then((result) => {
      if (log.querySelectorAll('li').length === 0) {
        appendLog(log, formatObservations(result));
      }
    })
    .finally(() => {
      observeBtn.disabled = false;
    });
});

recordBtn.addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  const recording = recordBtn.dataset.state === 'recording';
  recordBtn.disabled = true;
  const work = recording ? api.session.stop() : api.session.start();
  void work
    .catch((error: unknown) => {
      appendLog(log, `session failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      recordBtn.disabled = false;
    });
});

replayActBtn.addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  replayActBtn.disabled = true;
  void api.stagehand
    .act()
    .then((result) => {
      const summary = result.ok
        ? `act() ok · llmCalls=${String(result.llmCalls)} · ${String(result.results.length)} actions`
        : `act() failed: ${result.error ?? 'unknown'} (llmCalls=${String(result.llmCalls)})`;
      const failures = result.results
        .filter((row) => !row.success)
        .map((row) => `act fail ${row.method} ${row.selector}: ${row.message}`);
      appendLog(log, [summary, ...failures].join('\n'));
    })
    .finally(() => {
      replayActBtn.disabled = false;
    });
});

let dragging = false;

gutter.addEventListener('pointerdown', (event) => {
  dragging = true;
  gutter.setPointerCapture(event.pointerId);
});

gutter.addEventListener('pointerup', () => {
  dragging = false;
});

gutter.addEventListener('pointermove', (event) => {
  if (!dragging) {
    return;
  }
  const rect = workspace.getBoundingClientRect();
  splitRatio = clampRatio((event.clientX - rect.left) / rect.width, rect.width);
  applyRatio(browserSlot, splitRatio);
});

gutter.addEventListener('dblclick', () => {
  splitRatio = DEFAULT_SPLIT_RATIO;
  applyRatio(browserSlot, splitRatio);
});
