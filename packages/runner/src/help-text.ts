/**
 * Shared F-58 help text (H29a / L6-029).
 * Leaf module: imported by cli.ts, generated-run.ts, and run.ts. Do not import
 * those files from here (avoids cycles).
 */

const F58_FLAGS = `  --headless
  --base-url <url>
  --timeout <ms>
  --max-ai-retries <n>
  --no-ai
  --ai
  --report <dir>
  --trace`;

const REPORT_ABSOLUTE_AND_DEFAULT =
  'Absolute --report is used as-is. Omit --report for ../runs/<runId>/ from that directory.\n';

export function spyglassRunHelpText(): string {
  return `spyglass-run <scenario.json>
${F58_FLAGS}

Relative --report is resolved from dirname(<scenario.json>), not process.cwd() (A19a).
${REPORT_ABSOLUTE_AND_DEFAULT}`;
}

export function generatedHelpText(): string {
  return `scenario.ts — Spyglass generated runner (visible by default)
${F58_FLAGS}

Relative --report is resolved from the scenario directory (this script's folder), not process.cwd() (A19a).
${REPORT_ABSOLUTE_AND_DEFAULT}`;
}
