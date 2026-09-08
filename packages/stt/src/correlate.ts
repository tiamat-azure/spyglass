import type { DomAnchor, VoiceCorrelation } from './protocol.ts';
import { VOICE_CORRELATION_MS_DEFAULT } from './protocol.ts';

/**
 * Bind a finalized voice segment to a neighbouring DOM capture step (F-32, C2b).
 *
 * raw.jsonl is append-only. Prefer **before** / before-next when the utterance
 * *starts before* the next stable capture step. Overlap (speech continues past
 * the click) is not classified as after — that was the 8s after-preferring
 * residual.
 *
 * - No capture yet → before-next (predicted `correlatedStepIndex`).
 * - `startTs < lastDom.ts` → speech began before this capture → before it.
 * - `startTs >= lastDom.ts` within the margin → after (commentary).
 * - `startTs >= lastDom.ts` beyond the margin → before-next (new intention).
 */
export function correlateVoiceSegment(
  startTs: number,
  _endTs: number,
  lastDom: DomAnchor | undefined,
  lastStepIndex: number,
  marginMs: number = VOICE_CORRELATION_MS_DEFAULT
): VoiceCorrelation {
  const nextStep = Math.max(1, lastStepIndex + 1);
  if (lastDom === undefined) {
    return { relation: 'before', correlatedStepIndex: nextStep };
  }
  if (startTs < lastDom.ts) {
    return {
      relation: 'before',
      correlatedEventId: lastDom.eventId,
      correlatedStepIndex: lastDom.stepIndex
    };
  }
  if (startTs - lastDom.ts <= marginMs) {
    return {
      relation: 'after',
      correlatedEventId: lastDom.eventId,
      correlatedStepIndex: lastDom.stepIndex
    };
  }
  return { relation: 'before', correlatedStepIndex: nextStep };
}
