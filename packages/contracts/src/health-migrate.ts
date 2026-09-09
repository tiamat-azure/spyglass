/**
 * R28a / H21a: in-memory upgrade of pre-Lot-7 `patchCandidates` that omit
 * usable `runIds`. Defaults from existing non-empty string items, else
 * `lastRunId`. Does not bump `schemaVersion`. Leaves candidates without any
 * derivable run id unchanged so schema validation still fails.
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

function migratePatchCandidateRunIds(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  const candidate = entry as Record<string, unknown>;
  const derived = derivedCandidateRunIds(candidate);
  if (derived === undefined) {
    return entry;
  }
  return { ...candidate, runIds: derived };
}

function derivedCandidateRunIds(candidate: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(candidate.runIds)) {
    const usable = candidate.runIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
    if (usable.length > 0) {
      return usable;
    }
  }
  const lastRunId = candidate.lastRunId;
  if (typeof lastRunId === 'string' && lastRunId.length > 0) {
    return [lastRunId];
  }
  return undefined;
}
