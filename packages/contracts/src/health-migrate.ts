/**
 * R28a / H21a: in-memory upgrade of pre-Lot-7 `patchCandidates` that omit
 * `runIds`. Fills from `lastRunId`. Does not bump `schemaVersion`. Leaves
 * candidates without a derivable run id unchanged so schema validation still
 * fails.
 * L7-214: consecutiveRuns is capped to the migrated `runIds` window so a
 * legacy counter cannot auto-qualify (`>= confirmRuns`) from a single id.
 * L7-242: do not rewrite a candidate that already has `runIds` (empty/corrupt
 * current-schema records stay fail-closed).
 */
export function migrateHealthPatchCandidates(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }
  const health = parsed as Record<string, unknown>;
  if (!Array.isArray(health.patchCandidates)) {
    return parsed;
  }
  return {
    ...health,
    patchCandidates: health.patchCandidates.map(migratePatchCandidateRunIds)
  };
}

/** L7-148 / L7-211 / L7-220: same bound as health.schema.json runIds.maxItems. */
const MAX_CANDIDATE_RUN_IDS = 32;

function migratePatchCandidateRunIds(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  const candidate = entry as Record<string, unknown>;
  const derived = derivedCandidateRunIds(candidate);
  if (derived === undefined) {
    return entry;
  }
  const runIds = derived.slice(-MAX_CANDIDATE_RUN_IDS);
  const prior =
    typeof candidate.consecutiveRuns === 'number' && Number.isInteger(candidate.consecutiveRuns)
      ? candidate.consecutiveRuns
      : runIds.length;
  const consecutiveRuns = Math.max(1, Math.min(prior, runIds.length, MAX_CANDIDATE_RUN_IDS));
  return { ...candidate, runIds, consecutiveRuns };
}

function derivedCandidateRunIds(candidate: Record<string, unknown>): string[] | undefined {
  if (Object.hasOwn(candidate, 'runIds')) {
    return undefined;
  }
  const lastRunId = candidate.lastRunId;
  if (typeof lastRunId === 'string' && lastRunId.length > 0) {
    return [lastRunId];
  }
  return undefined;
}
