import type { DomAnchor, VoiceCorrelation } from './protocol.ts';
import { VOICE_CORRELATION_MS_DEFAULT } from './protocol.ts';

/**
 * Bind a finalized voice segment to the nearest DOM capture step (F-32).
 * raw.jsonl is append-only, so a "before" dictation predicts the next stepIndex
 * when the action has not been written yet.
 */
export function correlateVoiceSegment(
  startTs: number,
  endTs: number,
  lastDom: DomAnchor | undefined,
  lastStepIndex: number,
  marginMs: number = VOICE_CORRELATION_MS_DEFAULT
): VoiceCorrelation {
  const nextStep = lastStepIndex + 1;
  if (lastDom === undefined) {
    return { relation: 'before', correlatedStepIndex: Math.max(1, nextStep) };
  }
  const afterDelta = startTs - lastDom.ts;
  const beforeDelta = lastDom.ts - endTs;
  if (afterDelta >= 0 && afterDelta <= marginMs) {
    return {
      relation: 'after',
      correlatedEventId: lastDom.eventId,
      correlatedStepIndex: lastDom.stepIndex
    };
  }
  if (beforeDelta >= 0 && beforeDelta <= marginMs) {
    return {
      relation: 'before',
      correlatedEventId: lastDom.eventId,
      correlatedStepIndex: lastDom.stepIndex
    };
  }
  if (startTs <= lastDom.ts && endTs >= lastDom.ts) {
    return {
      relation: 'after',
      correlatedEventId: lastDom.eventId,
      correlatedStepIndex: lastDom.stepIndex
    };
  }
  if (afterDelta > marginMs) {
    return { relation: 'before', correlatedStepIndex: Math.max(1, nextStep) };
  }
  return { relation: 'unanchored' };
}
