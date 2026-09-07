import type {
  CapturedValue,
  ElementDescriptor,
  RawEvent,
  ReplayDescriptor
} from '@spyglass/contracts';
import {
  buildReplayDescriptor,
  maskCapturedValue,
  PAGE_ID_MAIN,
  type ProbeElementDescriptor,
  templateNarration
} from '@spyglass/probe';

export type ProbeWireEvent = {
  v?: number;
  kind: string;
  ts: number;
  page?: { url?: string; title?: string };
  target?: ProbeElementDescriptor;
  valueText?: string;
  type?: string;
  autocomplete?: string;
  name?: string;
  key?: string;
  scrollDelta?: number;
  selectedValue?: string;
  checked?: boolean;
};

export function asProbeWireEvent(input: unknown): ProbeWireEvent | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.kind !== 'string' || typeof record.ts !== 'number') {
    return undefined;
  }
  const event: ProbeWireEvent = { kind: record.kind, ts: record.ts };
  if (typeof record.v === 'number') {
    event.v = record.v;
  }
  if (typeof record.page === 'object' && record.page !== null) {
    const page = record.page as Record<string, unknown>;
    const pageInfo: { url?: string; title?: string } = {};
    if (typeof page.url === 'string') {
      pageInfo.url = page.url;
    }
    if (typeof page.title === 'string') {
      pageInfo.title = page.title;
    }
    event.page = pageInfo;
  }
  if (typeof record.target === 'object' && record.target !== null) {
    event.target = record.target as ProbeElementDescriptor;
  }
  if (typeof record.valueText === 'string') {
    event.valueText = record.valueText;
  }
  if (typeof record.type === 'string') {
    event.type = record.type;
  }
  if (typeof record.autocomplete === 'string') {
    event.autocomplete = record.autocomplete;
  }
  if (typeof record.name === 'string') {
    event.name = record.name;
  }
  if (typeof record.key === 'string') {
    event.key = record.key;
  }
  if (typeof record.scrollDelta === 'number') {
    event.scrollDelta = record.scrollDelta;
  }
  if (typeof record.selectedValue === 'string') {
    event.selectedValue = record.selectedValue;
  }
  if (typeof record.checked === 'boolean') {
    event.checked = record.checked;
  }
  return event;
}

function capturedValue(wire: ProbeWireEvent): CapturedValue | undefined {
  if (wire.valueText === undefined && wire.selectedValue === undefined && wire.key === undefined) {
    return undefined;
  }
  const text = wire.valueText ?? wire.selectedValue ?? wire.key ?? '';
  return maskCapturedValue(text, {
    type: wire.type,
    autocomplete: wire.autocomplete,
    name: wire.name ?? wire.target?.name
  });
}

function actionArgs(wire: ProbeWireEvent, value: CapturedValue | undefined): string[] | undefined {
  if (wire.kind === 'dom.scroll' && wire.scrollDelta !== undefined) {
    return ['0', String(Math.round(wire.scrollDelta))];
  }
  if (wire.kind === 'dom.key' && wire.key !== undefined) {
    return [wire.key];
  }
  if (wire.kind === 'dom.select' && wire.selectedValue !== undefined) {
    return [wire.selectedValue];
  }
  if (value?.masked === true) {
    return [value.secretRef];
  }
  if (value?.masked === false) {
    return [value.text];
  }
  return undefined;
}

export function isCaptureStepKind(kind: string): boolean {
  return kind.startsWith('dom.') || kind.startsWith('selection.');
}

export function buildRawEvent(options: {
  id: string;
  sessionId: string;
  wire: ProbeWireEvent;
  stepIndex?: number;
  snapshotRef?: string;
  screenshotRef?: string;
  pageFallback?: { url: string; title: string };
}): RawEvent {
  const { wire } = options;
  const event: RawEvent = {
    schemaVersion: 1,
    id: options.id,
    sessionId: options.sessionId,
    ts: wire.ts,
    kind: wire.kind as RawEvent['kind'],
    pageId: PAGE_ID_MAIN
  };
  if (options.stepIndex !== undefined) {
    event.stepIndex = options.stepIndex;
  }
  const page = wire.page ?? options.pageFallback;
  if (page !== undefined) {
    event.page = page;
  }
  if (wire.target !== undefined) {
    event.target = wire.target as ElementDescriptor;
  }
  const value = capturedValue(wire);
  if (value !== undefined) {
    event.value = value;
  }
  if (wire.target !== undefined) {
    const action = buildReplayDescriptor({
      kind: wire.kind,
      target: wire.target,
      description: templateNarration(wire.kind, wire.target),
      args: actionArgs(wire, value)
    });
    if (action !== undefined) {
      event.action = action as ReplayDescriptor;
    }
  }
  event.narration = {
    mode: 'template',
    text: templateNarration(wire.kind, wire.target)
  };
  if (options.snapshotRef !== undefined) {
    event.snapshotRef = options.snapshotRef;
  }
  if (options.screenshotRef !== undefined) {
    event.screenshotRef = options.screenshotRef;
  }
  return event;
}

export function buildControlEvent(options: {
  id: string;
  sessionId: string;
  kind: RawEvent['kind'];
  ts: number;
  page?: { url: string; title: string };
  retracts?: string;
}): RawEvent {
  const event: RawEvent = {
    schemaVersion: 1,
    id: options.id,
    sessionId: options.sessionId,
    ts: options.ts,
    kind: options.kind,
    pageId: PAGE_ID_MAIN
  };
  if (options.page !== undefined) {
    event.page = options.page;
  }
  if (options.retracts !== undefined) {
    event.retracts = options.retracts;
  }
  event.narration = { mode: 'template', text: templateNarration(options.kind) };
  return event;
}
