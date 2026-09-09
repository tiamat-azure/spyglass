import { isStaleCeilingRaiseCta } from '../../shared/ceiling-cta.ts';
import type {
  ChatMessagePayload,
  ConfigGetResponse,
  ConfigSetRequest,
  MaskedProfileConfig,
  NavState,
  RefineRevisionView,
  ReplayProgressPayload,
  SessionStatePayload,
  StagehandObserveResponse,
  UsagePayload
} from '../../shared/ipc.ts';
import { DEFAULT_SPLIT_RATIO, refineSourceBanner } from '../../shared/ipc.ts';
import { attachVoiceCapture } from './voice-capture.ts';

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

function relationFromMessage(message: ChatMessagePayload): string | undefined {
  if (!message.kind.startsWith('voice.')) {
    return undefined;
  }
  const match = /\((avant l'action|après l'action)\)/u.exec(message.text);
  if (match?.[1] === "avant l'action") {
    return 'before';
  }
  if (match?.[1] === "après l'action") {
    return 'after';
  }
  return undefined;
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
  const relation = relationFromMessage(message);
  if (relation !== undefined) {
    item.dataset.relation = relation;
    const rel = document.createElement('span');
    rel.className = 'voice-relation';
    rel.textContent =
      relation === 'before' ? 'avant' : relation === 'after' ? 'après' : 'hors fenêtre';
    meta.append(rel);
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

  if (message.kind === 'voice.final') {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'retract';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      const next = window.prompt('Corriger la dictée', message.transcript ?? message.text);
      if (next !== null && next.trim().length > 0) {
        void api.voice.edit(message.eventId, next.trim());
      }
    });
    item.append(edit);
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
  for (const item of log.querySelectorAll<HTMLLIElement>('li.chat-msg')) {
    if (!isStaleCeilingRaiseCta(usage.halt, item.dataset.banner)) {
      continue;
    }
    for (const button of item.querySelectorAll<HTMLButtonElement>('button.chat-action')) {
      button.disabled = true;
    }
  }
}

function aggressivenessValue(): 'conservative' | 'balanced' | 'aggressive' {
  const value = refineAggressiveness.value;
  if (value === 'conservative' || value === 'aggressive') {
    return value;
  }
  return 'balanced';
}

async function refreshRefinePanel(phase: string): Promise<void> {
  const show =
    phase === 'sealed' ||
    phase === 'refining' ||
    phase === 'reviewing' ||
    phase === 'finalized' ||
    phase === 'replaying';
  refinePanel.hidden = !show;
  refinePanel.dataset.phase = phase;
  replayPanel.hidden = phase !== 'finalized' && phase !== 'replaying';
  replayRunBtn.disabled = phase === 'replaying';
  replayPanel.dataset.running = phase === 'replaying' ? 'true' : 'false';
  if (phase === 'replaying') {
    replayStatus.textContent = 'Rejeu en cours — suivi étape par étape dans le chat.';
  } else if (phase === 'finalized') {
    replayStatus.textContent =
      'Scénario finalisé — rejeu déterministe dans le navigateur embarqué.';
  }
  if (!show || api === undefined) {
    return;
  }
  if (phase === 'sealed') {
    refineStatus.textContent = 'Session scellée — estimation smart avant déclenchement.';
    await loadEstimate();
  } else if (phase === 'refining') {
    refineStatus.textContent = 'Raffinement en cours (profil smart)…';
  } else if (phase === 'reviewing') {
    const revision = refinePanel.dataset.revision;
    refineStatus.textContent =
      revision !== undefined && revision.length > 0
        ? `Révision ${revision} éditable — confirmez les weak avant de finaliser.`
        : 'Révision éditable — confirmez les weak avant de finaliser.';
  } else if (phase === 'finalized') {
    refineStatus.textContent = 'Scénario raffiné finalisé — brut inchangé.';
  }
}

async function loadEstimate(): Promise<void> {
  if (api === undefined) {
    return;
  }
  const result = await api.refine.estimate(aggressivenessValue());
  if (!result.ok) {
    refineEstimate.textContent = result.error ?? 'estimation indisponible';
    refineEstimate.dataset.requiresConfirm = 'false';
    refineConfirmRow.hidden = true;
    return;
  }
  refineEstimate.textContent = `Estimation smart : ${String(result.estimatedTokens)} tokens (seuil ${String(result.threshold)} · ${result.model} · par opération)`;
  refineEstimate.dataset.requiresConfirm = result.requiresConfirm ? 'true' : 'false';
  refineConfirmRow.hidden = !result.requiresConfirm;
  if (!result.requiresConfirm) {
    refineConfirm.checked = false;
  }
}

function renderRefineRevision(revision: RefineRevisionView | undefined): void {
  refineSteps.replaceChildren();
  refineWeakList.replaceChildren();
  if (revision === undefined) {
    refinePanel.dataset.revision = '';
    refinePanel.dataset.source = '';
    refineSource.hidden = true;
    refineSource.textContent = '';
    refineFinalizeBtn.disabled = true;
    refineBlock.hidden = true;
    refineWeaks.hidden = true;
    return;
  }
  refinePanel.dataset.revision = String(revision.revision);
  refinePanel.dataset.source = revision.source;
  const banner = refineSourceBanner(revision.source);
  refineSource.hidden = false;
  refineSource.dataset.tone = banner.tone;
  refineSource.textContent = banner.text;
  for (const step of revision.steps) {
    const item = document.createElement('li');
    item.className = 'refine-step';
    item.dataset.index = String(step.index);
    item.dataset.strength = step.strength;
    if (step.weakGroup !== undefined) {
      item.dataset.weakGroup = step.weakGroup;
    }
    item.dataset.confirmed = step.confirmedByUser ? 'true' : 'false';
    const badge = document.createElement('span');
    badge.className = 'strength-badge';
    badge.dataset.strength = step.strength;
    badge.textContent = step.strength;
    const intent = document.createElement('p');
    intent.textContent = step.intent;
    const action = document.createElement('p');
    action.textContent = `${step.actionType} · ${step.selector} · ${step.verificationType}`;
    const expected = document.createElement('p');
    expected.textContent = `attendu ${step.expected}`;
    const ids = document.createElement('p');
    ids.className = 'source-ids';
    ids.textContent = `sourceEvents ${step.sourceEvents.join(', ')}`;
    item.append(badge, intent, action, expected, ids);
    if (revision.status === 'reviewing') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'retract';
      edit.textContent = 'Éditer l’intention';
      edit.addEventListener('click', () => {
        const next = window.prompt('Intention', step.intent);
        if (next !== null && next.trim().length > 0) {
          void api?.refine.edit({ index: step.index, intent: next.trim() });
        }
      });
      item.append(edit);
    }
    refineSteps.append(item);
  }
  const weaks = revision.steps.filter((step) => step.strength === 'weak');
  refineWeaks.hidden = weaks.length === 0 || revision.status === 'finalized';
  for (const step of weaks) {
    const item = document.createElement('li');
    item.className = 'refine-weak-item';
    item.dataset.index = String(step.index);
    item.dataset.weakGroup = step.weakGroup ?? 'doubtful';
    item.dataset.confirmed = step.confirmedByUser ? 'true' : 'false';
    const label = document.createElement('p');
    label.textContent = `${step.weakGroup === 'routine' ? 'routinière' : 'douteuse'} · ${step.weakReason ?? ''} · ${step.intent}`;
    item.append(label);
    if (!step.confirmedByUser && step.weakGroup !== 'routine') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'observe-btn';
      button.textContent = 'Confirmer';
      button.addEventListener('click', () => {
        void api?.refine.confirm({ index: step.index });
      });
      item.append(button);
    }
    refineWeakList.append(item);
  }
  refineConfirmRoutine.disabled = revision.routineUnconfirmed === 0;
  const blocked = revision.unconfirmedWeak > 0;
  refineBlock.hidden = !blocked;
  refineFinalizeBtn.disabled = blocked || revision.status === 'finalized';
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
  const smartConfirm = document.getElementById('smart-token-confirm');
  if (smartConfirm instanceof HTMLInputElement) {
    smartConfirm.value = String(config.smartTokenConfirm);
  }
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
const micBtn = requireEl<HTMLButtonElement>('mic-btn');
const voiceModeBtn = requireEl<HTMLButtonElement>('voice-mode');
const voiceLive = requireEl<HTMLElement>('voice-live');
const micLevel = requireEl<HTMLElement>('mic-level');
const tabBrowser = requireEl<HTMLButtonElement>('tab-browser');
const tabSettings = requireEl<HTMLButtonElement>('tab-settings');
const settingsPanel = requireEl<HTMLElement>('settings-panel');
const tokenMeter = requireEl<HTMLElement>('token-meter');
const tokenFill = requireEl<HTMLElement>('token-fill');
const tokenCounts = requireEl<HTMLElement>('token-counts');
const tokenHint = requireEl<HTMLElement>('token-hint');
const refinePanel = requireEl<HTMLElement>('refine-panel');
const refineStatus = requireEl<HTMLElement>('refine-status');
const refineSource = requireEl<HTMLElement>('refine-source');
const refineEstimate = requireEl<HTMLElement>('refine-estimate');
const refineAggressiveness = requireEl<HTMLSelectElement>('refine-aggressiveness');
const refineConfirmRow = requireEl<HTMLElement>('refine-confirm-row');
const refineConfirm = requireEl<HTMLInputElement>('refine-confirm');
const refineRunBtn = requireEl<HTMLButtonElement>('refine-run');
const refineFinalizeBtn = requireEl<HTMLButtonElement>('refine-finalize');
const refineBlock = requireEl<HTMLElement>('refine-block');
const refineWeaks = requireEl<HTMLElement>('refine-weaks');
const refineWeakList = requireEl<HTMLOListElement>('refine-weak-list');
const refineConfirmRoutine = requireEl<HTMLButtonElement>('refine-confirm-routine');
const refineSteps = requireEl<HTMLOListElement>('refine-steps');
const replayPanel = requireEl<HTMLElement>('replay-panel');
const replayStatus = requireEl<HTMLElement>('replay-status');
const replayAi = requireEl<HTMLInputElement>('replay-ai');
const replayStepwise = requireEl<HTMLInputElement>('replay-stepwise');
const replayRunBtn = requireEl<HTMLButtonElement>('replay-run');
const replayNextBtn = requireEl<HTMLButtonElement>('replay-next');
const replayHaltBtn = requireEl<HTMLButtonElement>('replay-halt');
const replaySteps = requireEl<HTMLOListElement>('replay-steps');
/** L7-204: halt must keep next disabled even if next()'s finally runs later. */
let replayHalted = false;
const sessionExportBtn = requireEl<HTMLButtonElement>('session-export');
const sessionImportBtn = requireEl<HTMLButtonElement>('session-import');
const sttUpgrade = requireEl<HTMLElement>('stt-upgrade');
const sttUpgradeCopy = requireEl<HTMLElement>('stt-upgrade-copy');
const sttUpgradeCopyDefault = sttUpgradeCopy.innerHTML;
const sttUpgradeAccept = requireEl<HTMLButtonElement>('stt-upgrade-accept');
const sttUpgradeRefuse = requireEl<HTMLButtonElement>('stt-upgrade-refuse');

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
    voice?.setArmed(recording);
    void refreshRefinePanel(state.state);
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

  api.refine.onState((payload) => {
    renderRefineRevision(payload.revision);
    void refreshRefinePanel(payload.phase);
  });

  api.replay.onProgress((payload: ReplayProgressPayload) => {
    const item = document.createElement('li');
    item.className = 'replay-step';
    item.dataset.status = payload.status;
    item.dataset.mode = payload.mode;
    item.dataset.index = String(payload.stepIndex);
    item.textContent = `étape ${String(payload.stepIndex)} · ${payload.mode} · ${payload.status} · ${payload.message}`;
    replaySteps.querySelectorAll('.replay-step[data-current="true"]').forEach((el) => {
      el.removeAttribute('data-current');
    });
    item.dataset.current = 'true';
    replaySteps.append(item);
    replayStatus.textContent = payload.message;
  });

  api.sttUpgrade.onOffer((payload) => {
    sttUpgradeCopy.innerHTML = sttUpgradeCopyDefault;
    sttUpgrade.hidden = !payload.propose;
  });
  void api.sttUpgrade
    .status()
    .then((status) => {
      sttUpgrade.hidden = !status.propose;
    })
    .catch(() => {
      sttUpgrade.hidden = true;
      sttUpgradeCopy.textContent = 'Mise à jour vocale indisponible. Réessayez.';
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

const voice =
  api === undefined
    ? undefined
    : attachVoiceCapture(api, {
        micButton: micBtn,
        modeButton: voiceModeBtn,
        liveEl: voiceLive,
        levelEl: micLevel
      });

micBtn.addEventListener('pointerdown', (event) => {
  if (voice === undefined) {
    return;
  }
  if (voice.mode() === 'continuous') {
    return;
  }
  event.preventDefault();
  void voice.startHold();
});

micBtn.addEventListener('pointerup', () => {
  if (voice === undefined || voice.mode() === 'continuous') {
    return;
  }
  void voice.endHold();
});

micBtn.addEventListener('pointerleave', () => {
  if (voice === undefined || voice.mode() === 'continuous') {
    return;
  }
  void voice.endHold();
});

micBtn.addEventListener('click', () => {
  if (voice === undefined || voice.mode() !== 'continuous') {
    return;
  }
  void voice.toggleContinuous();
});

voiceModeBtn.addEventListener('click', () => {
  if (voice === undefined) {
    return;
  }
  const next = voice.mode() === 'hold' ? 'continuous' : 'hold';
  voice.setMode(next);
  micBtn.dataset.mode = next;
});

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
  if (recording || retrySeal) {
    voice?.setArmed(false);
  }
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

replayRunBtn.addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  replayRunBtn.disabled = true;
  replaySteps.replaceChildren();
  const forceAi = replayAi.checked;
  const stepByStep = replayStepwise.checked;
  replayHalted = false;
  replayNextBtn.disabled = !stepByStep;
  replayHaltBtn.disabled = !stepByStep;
  void api.replay
    .start(forceAi, !forceAi, stepByStep)
    .then((result) => {
      if (!result.ok) {
        replayStatus.textContent = result.error;
        appendLog(log, `replay failed: ${result.error}`);
        return;
      }
      replayStatus.textContent = `run ${result.runId}`;
      replayPanel.dataset.runId = result.runId;
    })
    .finally(() => {
      replayRunBtn.disabled = false;
      replayNextBtn.disabled = true;
      replayHaltBtn.disabled = true;
    });
});

replayNextBtn.addEventListener('click', () => {
  if (api === undefined || replayNextBtn.disabled) {
    return;
  }
  replayNextBtn.disabled = true;
  void api.replay
    .next()
    .then((result) => {
      if (!result.ok) {
        replayStatus.textContent = result.error;
      }
    })
    .catch((error: unknown) => {
      replayStatus.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      if (!replayHalted && !replayHaltBtn.disabled) {
        replayNextBtn.disabled = false;
      }
    });
});

replayHaltBtn.addEventListener('click', () => {
  if (api === undefined || replayHaltBtn.disabled) {
    return;
  }
  replayHalted = true;
  replayNextBtn.disabled = true;
  replayHaltBtn.disabled = true;
  void api.replay
    .stop()
    .then((result) => {
      if (!result.ok) {
        replayStatus.textContent = result.error;
      }
    })
    .catch((error: unknown) => {
      replayStatus.textContent = error instanceof Error ? error.message : String(error);
    });
});

sessionExportBtn.addEventListener('click', () => {
  if (api === undefined || sessionExportBtn.disabled || sessionImportBtn.disabled) {
    return;
  }
  sessionExportBtn.disabled = true;
  sessionImportBtn.disabled = true;
  void api.sessionBundle
    .exportSession()
    .then((result) => {
      if (!result.ok && result.error === 'cancelled') {
        return;
      }
      replayStatus.textContent = result.ok ? `export ${result.sessionId}` : result.error;
    })
    .catch((error: unknown) => {
      replayStatus.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      sessionExportBtn.disabled = false;
      sessionImportBtn.disabled = false;
    });
});

sessionImportBtn.addEventListener('click', () => {
  if (api === undefined || sessionExportBtn.disabled || sessionImportBtn.disabled) {
    return;
  }
  sessionExportBtn.disabled = true;
  sessionImportBtn.disabled = true;
  void api.sessionBundle
    .importSession()
    .then((result) => {
      if (!result.ok && result.error === 'cancelled') {
        return;
      }
      replayStatus.textContent = result.ok ? `import ${result.sessionId}` : result.error;
    })
    .catch((error: unknown) => {
      replayStatus.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      sessionExportBtn.disabled = false;
      sessionImportBtn.disabled = false;
    });
});

sttUpgradeAccept.addEventListener('click', () => {
  if (api === undefined || sttUpgradeAccept.disabled || sttUpgradeRefuse.disabled) {
    return;
  }
  sttUpgradeAccept.disabled = true;
  sttUpgradeRefuse.disabled = true;
  sttUpgradeCopy.textContent = 'Téléchargement en cours…';
  void api.sttUpgrade
    .decide('accept')
    .then((result) => {
      if (result.ok) {
        sttUpgrade.hidden = true;
        return;
      }
      sttUpgradeCopy.textContent = result.error ?? 'Mise à jour vocale indisponible. Réessayez.';
    })
    .catch(() => {
      sttUpgradeCopy.textContent = 'Mise à jour vocale indisponible. Réessayez.';
    })
    .finally(() => {
      sttUpgradeAccept.disabled = false;
      sttUpgradeRefuse.disabled = false;
    });
});

sttUpgradeRefuse.addEventListener('click', () => {
  if (api === undefined || sttUpgradeAccept.disabled || sttUpgradeRefuse.disabled) {
    return;
  }
  sttUpgradeAccept.disabled = true;
  sttUpgradeRefuse.disabled = true;
  void api.sttUpgrade
    .decide('refuse')
    .then((result) => {
      if (result.ok) {
        sttUpgrade.hidden = true;
        return;
      }
      sttUpgradeCopy.textContent = result.error ?? 'Mise à jour vocale indisponible. Réessayez.';
    })
    .catch(() => {
      sttUpgradeCopy.textContent = 'Mise à jour vocale indisponible. Réessayez.';
    })
    .finally(() => {
      sttUpgradeAccept.disabled = false;
      sttUpgradeRefuse.disabled = false;
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
  const smartConfirm = Number.parseInt(
    requireEl<HTMLInputElement>('smart-token-confirm').value,
    10
  );
  void (async () => {
    const first = await api.config.set({
      profile: 'fast',
      ...fast,
      enrichmentEnabled: requireEl<HTMLInputElement>('enrichment-enabled').checked,
      sessionTokenLimitFast: limit,
      tokenWarnRatio: warn,
      rateLimitCallsPerMin: rate,
      smartTokenConfirm: smartConfirm
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

refineAggressiveness.addEventListener('change', () => {
  void loadEstimate();
});

refineRunBtn.addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  refineRunBtn.disabled = true;
  void api.refine
    .run(aggressivenessValue(), refineConfirm.checked)
    .then((result) => {
      if (!result.ok) {
        refineStatus.textContent = result.error;
        if (result.needsConfirm === true) {
          refineConfirmRow.hidden = false;
          refineEstimate.dataset.requiresConfirm = 'true';
        }
        return;
      }
      renderRefineRevision(result.revision);
    })
    .finally(() => {
      refineRunBtn.disabled = false;
    });
});

refineFinalizeBtn.addEventListener('click', () => {
  if (api === undefined) {
    return;
  }
  void api.refine.finalize().then((result) => {
    if (!result.ok) {
      refineBlock.hidden = false;
      refineBlock.textContent = `Finalisation bloquée : ${result.error}${
        result.unconfirmedWeak !== undefined ? ` (${String(result.unconfirmedWeak)})` : ''
      }`;
      return;
    }
    renderRefineRevision(result.revision);
  });
});

refineConfirmRoutine.addEventListener('click', () => {
  void api?.refine.confirm({ routine: true });
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
