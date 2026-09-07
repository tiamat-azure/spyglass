/**
 * Injected probe scaffold (Lot -1). No page instrumentation yet (Lot 1).
 */
export const PROBE_PACKAGE = '@spyglass/probe' as const;

export function probePackageName(): typeof PROBE_PACKAGE {
  return PROBE_PACKAGE;
}
