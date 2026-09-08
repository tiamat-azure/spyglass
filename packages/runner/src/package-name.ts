export const RUNNER_PACKAGE = '@spyglass/runner' as const;

export function runnerPackageName(): typeof RUNNER_PACKAGE {
  return RUNNER_PACKAGE;
}
