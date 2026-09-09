import type {
  RefinedStep,
  ReplayDescriptor,
  Scenario,
  SuggestedPatch,
  SuggestedPatchEntry
} from '@spyglass/contracts';
import {
  cloneJsonArg,
  isSecretParameterName,
  isSecretSelector,
  looksMaskedParameterValue,
  stripParameterizedArgument,
  unappliedArguments
} from './parameters.ts';
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
  const matches = scenario.steps.filter((step) => step.index === stepIndex);
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0];
}

/** L7-038: persist suggested-patch originals from the recorded scenario, without parameter args. */
export function originalDescriptorForPatch(step: RefinedStep): ReplayDescriptor {
  const descriptor = cloneDescriptor(step.action.descriptor);
  if (hasParameterRef(step)) {
    stripParameterizedArgument(descriptor);
  }
  return descriptor;
}

/** L7-236: never persist a dataset-materialized live fill/select as `original`. */
export function originalWithoutLiveFillArgs(descriptor: ReplayDescriptor): ReplayDescriptor {
  const clone = cloneDescriptor(descriptor);
  if (clone.type === 'fill' || clone.type === 'select') {
    delete clone.arguments;
  }
  return clone;
}

function isSecretArgType(type: ReplayDescriptor['type']): boolean {
  return type === 'fill' || type === 'select';
}

function addStringArg(into: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) {
    into.add(value);
  }
}

function addKnownValuesFromDescriptor(into: Set<string>, descriptor: ReplayDescriptor): void {
  if (!isSecretArgType(descriptor.type)) {
    return;
  }
  const args = descriptor.arguments ?? [];
  if (isSecretSelector(descriptor.selector)) {
    addStringArg(into, args[0]);
  }
  for (const argument of args) {
    if (typeof argument === 'string' && looksMaskedParameterValue(argument)) {
      into.add(argument);
    }
  }
}

function addKnownValuesFromStep(into: Set<string>, step: RefinedStep): void {
  const descriptor = step.action.descriptor;
  if (!isSecretArgType(descriptor.type)) {
    return;
  }
  const ref = step.action.parameterRef;
  const secretField =
    hasParameterRef(step) ||
    isSecretSelector(descriptor.selector) ||
    (ref !== undefined && isSecretParameterName(ref));
  if (secretField) {
    addStringArg(into, descriptor.arguments?.[0]);
  }
  addKnownValuesFromDescriptor(into, descriptor);
}

/**
 * P28b / R19a: known parameter and secret fill/select values, including
 * secret-named fields that were never given a `parameterRef`.
 */
export function collectKnownParameterSecretValues(
  ...stepLists: Array<readonly RefinedStep[] | undefined>
): Set<string> {
  const known = new Set<string>();
  for (const steps of stepLists) {
    if (steps === undefined) {
      continue;
    }
    for (const step of steps) {
      addKnownValuesFromStep(known, step);
    }
  }
  return known;
}

function isKnownSecretString(value: unknown, known: ReadonlySet<string>): boolean {
  return typeof value === 'string' && value.length > 0 && known.has(value);
}

/**
 * L7-232 / N29a / A27b: scrub secrets in place. Vacant slots are JSON `null`
 * so later indices do not shift. Non-string JSON args are kept, not dropped.
 */
function scrubKnownValuesFromDescriptor(
  descriptor: ReplayDescriptor,
  known: ReadonlySet<string>
): void {
  if (!isSecretArgType(descriptor.type) || descriptor.arguments === undefined) {
    return;
  }
  const scrubbed: unknown[] = [];
  for (const item of descriptor.arguments) {
    if (isKnownSecretString(item, known)) {
      scrubbed.push(null);
      continue;
    }
    const kept = cloneJsonArg(item);
    scrubbed.push(kept === undefined ? null : kept);
  }
  const trailing = scrubbed.slice(1);
  const head = scrubbed[0];
  // L7-254: vacant-string/blank rules apply to string heads and to a vacant
  // JSON `null` after scrub. Object/number/boolean slot 0 must stay.
  if (typeof head === 'string') {
    const keepHead = head.length > 0;
    if (!keepHead && trailing.length === 0) {
      delete descriptor.arguments;
      return;
    }
    if (keepHead) {
      descriptor.arguments = scrubbed as string[];
      return;
    }
    descriptor.arguments = unappliedArguments(trailing);
    return;
  }
  if (head === undefined || head === null) {
    if (trailing.length === 0) {
      delete descriptor.arguments;
      return;
    }
    descriptor.arguments = unappliedArguments(trailing);
    return;
  }
  descriptor.arguments = scrubbed as string[];
}

function knownValuesForPatch(
  patch: SuggestedPatchEntry,
  recordedStep: RefinedStep | undefined,
  extra: ReadonlySet<string> | readonly string[] | undefined
): Set<string> {
  const known = new Set<string>();
  if (extra !== undefined) {
    for (const value of extra) {
      if (value.length > 0) {
        known.add(value);
      }
    }
  }
  if (recordedStep !== undefined) {
    addKnownValuesFromStep(known, recordedStep);
  }
  addKnownValuesFromDescriptor(known, patch.original);
  addKnownValuesFromDescriptor(known, patch.suggested);
  return known;
}

/**
 * P13a / P28b: fail-closed redaction of dataset-materialized and known
 * secret args on proposed/`after` descriptors before suggested-patch.json
 * or health candidate hashes. P28b scrubs by value even when the recorded
 * step has no `parameterRef`.
 */
export function redactSuggestedPatchEntryForPersistence(
  patch: SuggestedPatchEntry,
  recordedStep?: RefinedStep,
  knownValues?: ReadonlySet<string> | readonly string[]
): SuggestedPatchEntry {
  const original = cloneDescriptor(patch.original);
  const suggested = cloneDescriptor(patch.suggested);
  const known = knownValuesForPatch(patch, recordedStep, knownValues);
  const secretType = isSecretArgType(original.type) || isSecretArgType(suggested.type);
  if (hasParameterRef(recordedStep)) {
    stripParameterizedArgument(original);
    stripParameterizedArgument(suggested);
  } else if (recordedStep === undefined && secretType) {
    // L7-106: missing/ambiguous recorded step — do not keep fill/select args.
    delete original.arguments;
    delete suggested.arguments;
  } else if (original.arguments === undefined && secretType) {
    delete suggested.arguments;
  }
  scrubKnownValuesFromDescriptor(original, known);
  scrubKnownValuesFromDescriptor(suggested, known);
  return { ...patch, original, suggested };
}

export function redactSuggestedPatchForPersistence(
  suggested: SuggestedPatch,
  scenario?: Scenario,
  liveSteps?: readonly RefinedStep[]
): SuggestedPatch {
  const known = collectKnownParameterSecretValues(scenario?.steps, liveSteps);
  for (const patch of suggested.patches) {
    addKnownValuesFromDescriptor(known, patch.original);
    addKnownValuesFromDescriptor(known, patch.suggested);
  }
  return {
    ...suggested,
    patches: suggested.patches.map((patch) =>
      redactSuggestedPatchEntryForPersistence(
        patch,
        findStepByIndex(scenario, patch.stepIndex),
        known
      )
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
