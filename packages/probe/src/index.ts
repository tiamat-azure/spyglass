/**
 * Injected DOM probe (Lot 1). Passive, multi-frame, open shadow DOM.
 */
export const PROBE_PACKAGE = '@spyglass/probe' as const;

export function probePackageName(): typeof PROBE_PACKAGE {
  return PROBE_PACKAGE;
}

export {
  INPUT_AGGREGATION_MS,
  NET_CORRELATION_MS,
  PAGE_ID_MAIN,
  PROBE_CONSOLE_PREFIX,
  SCREENSHOT_JPEG_QUALITY,
  SCREENSHOT_RETENTION,
  SCROLL_THRESHOLD_PX,
  TEXT_MAX_LENGTH
} from './constants.ts';
export {
  CLICK_CHANGE_WINDOW_MS,
  InputAggregator,
  isDenoisedClickForChange,
  isLabelClickForControlChange,
  isRedundantClickBeforeChange,
  isSignificantKey,
  shouldCaptureScroll,
  targetKey
} from './denoise.ts';
export type { MaskableField, MaskDecision } from './masking.ts';
export { maskCapturedValue, secretRefFor, shouldMaskField } from './masking.ts';
export type {
  ObserveCompatibleAction,
  ProbeElementDescriptor,
  ReplayDescriptor
} from './replay.ts';
export {
  buildReplayDescriptor,
  checkedStateArgument,
  hopSelector,
  pickSelectorStrategy,
  replayTypeForKind,
  stagehandMethodFor,
  templateNarration,
  toObserveResult
} from './replay.ts';
export type { ProbeInjectConfig } from './runtime.ts';
export { spyglassProbeMain } from './runtime.ts';
export type { LightweightSnapshot } from './snapshot.ts';
export { collectSnapshot, snapshotScript } from './snapshot.ts';
export { buildProbeSource } from './source.ts';
