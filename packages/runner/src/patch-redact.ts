import type {
  RefinedStep,
  ReplayDescriptor,
  Scenario,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import { cloneDescriptor } from './scenario.ts';

export function hasParameterRef(step: RefinedStep | undefined): boolean {
  const ref = step?.action.parameterRef;
  return ref !== undefined && ref.length > 0;
}

export function findStepByIndex(
  scenario: Scenario | undefined,
  stepIndex: number
): RefinedStep | undefined {
  if (scenario === undefined) {
    return undefined;
  }
  return scenario.steps.find((step) => step.index === stepIndex) ?? scenario.steps[stepIndex];
}

/** L7-038: persist suggested-patch originals from the recorded scenario, without parameter args. */
export function originalDescriptorForPatch(step: RefinedStep): ReplayDescriptor {
  const descriptor = cloneDescriptor(step.action.descriptor);
  if (hasParameterRef(step)) {
    delete descriptor.arguments;
  }
  return descriptor;
}

function isSecretArgType(type: ReplayDescriptor['type']): boolean {
  return type === 'fill' || type === 'select';
}

/**
 * P13a: fail-closed redaction of dataset-materialized args on proposed/`after`
 * descriptors before suggested-patch.json or health candidate hashes.
 */
export function redactSuggestedPatchEntryForPersistence(
  patch: SuggestedPatchEntry,
  recordedStep?: RefinedStep
): SuggestedPatchEntry {
  const original = cloneDescriptor(patch.original);
  const suggested = cloneDescriptor(patch.suggested);
  if (hasParameterRef(recordedStep)) {
    delete original.arguments;
    delete suggested.arguments;
  } else if (
    original.arguments === undefined &&
    (isSecretArgType(original.type) || isSecretArgType(suggested.type))
  ) {
    delete suggested.arguments;
  }
  return { ...patch, original, suggested };
}

export function redactSuggestedPatchForPersistence(
  suggested: SuggestedPatch,
  scenario?: Scenario
): SuggestedPatch {
  return {
    ...suggested,
    patches: suggested.patches.map((patch) =>
      redactSuggestedPatchEntryForPersistence(patch, findStepByIndex(scenario, patch.stepIndex))
    )
  };
}

/**
 * Overlay dataset-materialized fill/select args for recovery *execution* only.
 * The overlay must not be persisted (P13a redacts before disk / health).
 */
export function overlayLiveArgumentsForRecovery(
  recorded: ReplayDescriptor,
  liveStep: RefinedStep | undefined
): ReplayDescriptor {
  const clone = cloneDescriptor(recorded);
  if (liveStep === undefined || !hasParameterRef(liveStep)) {
    return clone;
  }
  if (liveStep.action.descriptor.arguments === undefined) {
    return clone;
  }
  clone.arguments = [...liveStep.action.descriptor.arguments];
  return clone;
}
