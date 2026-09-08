import type {
  ChatMessagePayload,
  ConfigGetResponse,
  ConfigSetRequest,
  MaskedProfileConfig,
  NavState,
  SessionStatePayload,
  StagehandObserveResponse,
  UsagePayload
} from '../../shared/ipc.ts';
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
  item.className = 'chat-msg';
  item.dataset.mode = 'system';
  const body = document.createElement('p');
  body.className = 'chat-body';
  body.textContent = text;
  item.append(body);
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

function clock(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('fr-FR', { hour12: false });
}

function renderChatMessage(
  log: HTMLOListElement,
  api: NonNullable<typeof window.spyglass>,
  message: ChatMessagePayload
): void {
  const existing = log.querySelector(`[data-event-id="${CSS.escape(message.eventId)}"]`);
  const item = existing instanceof HTMLLIElement ? existing : document.createElement('li');
  item.className = 'chat-msg';
  item.dataset.eventId = message.eventId;
  item.dataset.kind = message.kind;
  item.dataset.mode = message.mode;
  const latency = Math.max(0, Date.now() - message.issuedAt);
  item.dataset.latencyMs = String(latency);
  if (message.banner !== undefined) {
    item.dataset.banner = message.banner;
  }
  item.replaceChildren();

  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  const time = document.createElement('span');
  time.textContent = clock(message.issuedAt);
  meta.append(time);
  if (message.stepIndex !== undefined) {
    const step = document.createElement('span');
    step.textContent = `étape ${String(message.stepIndex).padStart(2, '0')}`;
    meta.append(step);
  }
  const pill = document.createElement('span');
  pill.className = 'mode-pill';
  pill.dataset.mode = message.mode;
  pill.textContent =
    message.mode === 'template'
      ? 'gabarit déterministe'
      : message.mode === 'llm'
        ? 'enrichi'
        : message.kind;
  meta.append(pill);
  item.append(meta);

  const body = document.createElement('p');
  body.className = 'chat-body';
  body.textContent = message.text;
  item.append(body);

  if (message.technical !== undefined && message.technical.length > 0) {
    const details = document.createElement('details');
    details.className = 'tech-block';
    const summary = document.createElement('summary');
    summary.textContent = 'descripteur DOM';
    const grid = document.createElement('div');
    grid.className = 'tech-grid';
    const pre = document.createElement('pre');
    pre.textContent = message.technical;
    grid.append(pre);
    details.append(summary, grid);
    item.append(details);
  }

  if (message.retractable) {
    const retract = document.createElement('button');
    retract.type = 'button';
    retract.className = 'retract';
    retract.textContent = 'Retract';
    retract.addEventListener('click', () => {
      void api.session.retract(message.eventId);
    });
    item.append(retract);
  }

  if (message.actions !== undefined) {
    for (const action of message.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        void api.usage.raiseCeiling();
      });
      item.append(button);
    }
  }

  if (!(existing instanceof HTMLLIElement)) {
    log.append(item);
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  if (nearBottom) {
    log.scrollTop = log.scrollHeight;
  }
}

function applyUsage(
  meter: HTMLElement,
  fill: HTMLElement,
  counts: HTMLElement,
  hint: HTMLElement,
  usage: UsagePayload,
  log: HTMLOListElement
): void {
  const pct = Math.min(100, Math.max(0, usage.ratio * 100));
  fill.style.width = `${String(pct)}%`;
  counts.textContent = `${String(usage.totalTokens)} / ${String(usage.ceiling)}`;
  const level = usage.halt === 'ceiling' || pct >= 100 ? 'danger' : pct >= 50 ? 'warn' : 'ok';
  meter.dataset.level = level;
  const usd =
    usage.estimatedUsd !== undefined ? ` · ~$${usage.estimatedUsd.toFixed(4)} (indicative)` : '';
  hint.textContent =
    usage.halt === 'none'
      ? `${String(usage.calls)} calls · ${String(usage.inputTokens)} in / ${String(usage.outputTokens)} out${usd}`
      : `enrichment ${usage.halt} · recording continues${usd}`;
  const limit = document.getElementById('session-token-limit');
  if (limit instanceof HTMLInputElement && document.activeElement !== limit) {
    limit.value = String(usage.ceiling);
  }
  if (usage.halt !== 'ceiling') {
    for (const button of log.querySelectorAll<HTMLButtonElement>('button.chat-action')) {
      button.disabled = true;
    }
  }
}

function sourceLabel(source: string): string {
  if (source === 'ui') {
    return 'réglée';
  }
  if (source === 'env') {
    return 'env';
  }
  return 'défaut';
}

function fillProfile(prefix: 'fast' | 'smart', profile: MaskedProfileConfig): void {
  requireEl<HTMLInputElement>(`${prefix}-provider`).value = profile.provider;
  requireEl<HTMLInputElement>(`${prefix}-model`).value = profile.model;
  requireEl<HTMLInputElement>(`${prefix}-baseUrl`).value = profile.baseUrl;
  requireEl<HTMLInputElement>(`${prefix}-apiKey`).value = profile.apiKeyMasked;
  const map: Record<string, string> = {
    provider: profile.sources.provider,
    model: profile.sources.model,
    baseUrl: profile.sources.baseUrl,
    apiKey: profile.sources.apiKey
  };
  for (const [key, source] of Object.entries(map)) {
    const pill = document.querySelector(`[data-source-for="${prefix}-${key}"]`);
    if (pill instanceof HTMLElement) {
      pill.textContent = sourceLabel(source);
    }
  }
}

function readProfile(
  prefix: 'fast' | 'smart'
): Pick<ConfigSetRequest, 'provider' | 'model' | 'baseUrl' | 'apiKey'> {
  const apiKey = requireEl<HTMLInputElement>(`${prefix}-apiKey`).value;
  const patch: Pick<ConfigSetRequest, 'provider' | 'model' | 'baseUrl' | 'apiKey'> = {
    provider: requireEl<HTMLInputElement>(`${prefix}-provider`).value,
    model: requireEl<HTMLInputElement>(`${prefix}-model`).value,
    baseUrl: requireEl<HTMLInputElement>(`${prefix}-baseUrl`).value
  };
  if (apiKey.length > 0 && !apiKey.startsWith('•')) {
    patch.apiKey = apiKey;
  }
  return patch;
}

async function loadSettings(api: NonNullable<typeof window.spyglass>): Promise<void> {
  const config = await api.config.get();
  applyConfigForm(config);
}

function applyConfigForm(config: ConfigGetResponse): void {
  fillProfile('fast', config.fast);
  fillProfile('smart', config.smart);
  requireEl<HTMLInputElement>('session-token-limit').value = String(config.sessionTokenLimitFast);
  requireEl<HTMLInputElement>('token-warn-ratio').value = String(config.tokenWarnRatio);
  requireEl<HTMLInputElement>('rate-limit').value = String(config.rateLimitCallsPerMin);
  requireEl<HTMLInputElement>('enrichment-enabled').checked = config.enrichmentEnabled;
  const encryption = requireEl<HTMLElement>('encryption-status');
  encryption.textContent = config.encryptionAvailable
    ? 'safeStorage encryption is available. Keys are stored as ciphertext.'
    : 'safeStorage unavailable on this host — keys stay in memory / env, never plaintext on disk.';
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
const tabBrowser = requireEl<HTMLButtonElement>('tab-browser');
const tabSettings = requireEl<HTMLButtonElement>('tab-settings');
const settingsPanel = requireEl<HTMLElement>('settings-panel');
const tokenMeter = requireEl<HTMLElement>('token-meter');
const tokenFill = requireEl<HTMLElement>('token-fill');
const tokenCounts = requireEl<HTMLElement>('token-counts');
const tokenHint = requireEl<HTMLElement>('token-hint');

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

function showTab(name: 'browser' | 'settings'): void {
  const settings = name === 'settings';
  tabBrowser.setAttribute('aria-selected', settings ? 'false' : 'true');
  tabSettings.setAttribute('aria-selected', settings ? 'true' : 'false');
  settingsPanel.hidden = !settings;
  api?.layout.setGuestVisible(!settings);
  if (!settings) {
    reportBounds();
  }
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
    const stopping = state.state === 'stopping';
    const sealedFailed = state.state === 'sealed-failed';
    const busy = recording || stopping;
    recordBtn.dataset.state = stopping
      ? 'stopping'
      : recording
        ? 'recording'
        : sealedFailed
          ? 'sealed-failed'
          : 'idle';
    recordBtn.textContent = stopping
      ? 'Stopping'
      : recording
        ? 'Stop'
        : sealedFailed
          ? 'Retry Stop'
          : 'Record';
    recordBtn.disabled = stopping;
    recPill.dataset.active = busy ? 'true' : 'false';
    recPill.title = stopping
      ? 'Stopping'
      : recording
        ? 'Recording'
        : sealedFailed
          ? 'Seal failed — retry Stop to write meta.json'
          : 'Recording idle';
    browserSlot.dataset.recording = busy ? 'true' : 'false';
  });

  api.session.onEvent((event) => {
    if (event.kind === 'step.retracted' && typeof event.retracts === 'string') {
      const previous = log.querySelector(`[data-event-id="${CSS.escape(event.retracts)}"]`);
      if (previous instanceof HTMLElement) {
        previous.dataset.retracted = 'true';
      }
    }
  });

  api.chat.onMessage((message) => {
    renderChatMessage(log, api, message);
  });

  api.chat.onEnriched((payload) => {
    const item = log.querySelector(`[data-event-id="${CSS.escape(payload.eventId)}"]`);
    if (!(item instanceof HTMLElement)) {
      return;
    }
    item.dataset.mode = 'llm';
    const body = item.querySelector('.chat-body');
    if (body instanceof HTMLElement) {
      body.textContent = payload.text;
    }
    const pill = item.querySelector('.mode-pill');
    if (pill instanceof HTMLElement) {
      pill.dataset.mode = 'llm';
      pill.textContent = 'enrichi';
    }
  });

  api.usage.onUpdate((usage: UsagePayload) => {
    applyUsage(tokenMeter, tokenFill, tokenCounts, tokenHint, usage, log);
  });

  void api.stagehand.cdp().then((info) => {
    if (info.port <= 0 || info.cdpUrl.length === 0) {
      cdpStatus.textContent = 'CDP off — set SPYGLASS_CDP=1';
      return;
    }
    const target = info.targetId === undefined ? 'resolving' : info.targetId.slice(0, 8);
    cdpStatus.textContent = `CDP ${info.cdpUrl} · target ${target}`;
  });

  void loadSettings(api);
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

tabBrowser.addEventListener('click', () => {
  showTab('browser');
});
tabSettings.addEventListener('click', () => {
  showTab('settings');
  if (api !== undefined) {
    void loadSettings(api);
  }
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
  if (recordBtn.dataset.state === 'stopping' || recordBtn.disabled) {
    return;
  }
  const recording = recordBtn.dataset.state === 'recording';
  const retrySeal = recordBtn.dataset.state === 'sealed-failed';
  recordBtn.disabled = true;
  const work = recording || retrySeal ? api.session.stop() : api.session.start();
  void work
    .catch((error: unknown) => {
      appendLog(log, `session failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      if (recordBtn.dataset.state !== 'stopping') {
        recordBtn.disabled = false;
      }
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

requireEl<HTMLButtonElement>('fast-test').addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  const status = requireEl<HTMLElement>('fast-test-status');
  status.textContent = 'test en cours';
  status.removeAttribute('data-ok');
  void api.config.test('fast').then((result) => {
    status.dataset.ok = result.ok ? 'true' : 'false';
    status.textContent = result.ok
      ? `Connexion établie, ${String(result.latencyMs)} ms`
      : (result.error ?? 'échec');
  });
});

requireEl<HTMLButtonElement>('smart-test').addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  const status = requireEl<HTMLElement>('smart-test-status');
  status.textContent = 'test en cours';
  status.removeAttribute('data-ok');
  void api.config.test('smart').then((result) => {
    status.dataset.ok = result.ok ? 'true' : 'false';
    const extra = result.multimodal ? '' : ' · modèle non multimodal (avertissement)';
    status.textContent = result.ok
      ? `Connexion établie, ${String(result.latencyMs)} ms${extra}`
      : (result.error ?? 'échec');
  });
});

requireEl<HTMLButtonElement>('settings-save').addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  const status = requireEl<HTMLElement>('settings-save-status');
  const fast = readProfile('fast');
  const smart = readProfile('smart');
  const limit = Number.parseInt(requireEl<HTMLInputElement>('session-token-limit').value, 10);
  const warn = Number.parseFloat(requireEl<HTMLInputElement>('token-warn-ratio').value);
  const rate = Number.parseInt(requireEl<HTMLInputElement>('rate-limit').value, 10);
  void (async () => {
    const first = await api.config.set({
      profile: 'fast',
      ...fast,
      enrichmentEnabled: requireEl<HTMLInputElement>('enrichment-enabled').checked,
      sessionTokenLimitFast: limit,
      tokenWarnRatio: warn,
      rateLimitCallsPerMin: rate
    });
    const second = await api.config.set({ profile: 'smart', ...smart });
    status.dataset.ok = first.ok && second.ok ? 'true' : 'false';
    status.textContent =
      first.ok && second.ok
        ? first.persistedKey
          ? 'Saved (keys encrypted)'
          : (first.error ?? 'Saved')
        : (first.error ?? second.error ?? 'save failed');
  })();
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
