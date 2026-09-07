/**
 * @spyglass/runner — package scaffold only (Lot -1).
 * `runScenario` is implemented in Lot 5 (PRD §6.12, ADR-0006).
 */
export const RUNNER_PACKAGE = '@spyglass/runner' as const;

export function runnerPackageName(): typeof RUNNER_PACKAGE {
  return RUNNER_PACKAGE;
}
