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

const LOT7_FLAGS = `  --dataset <file>
  --repo <git-root>
  --session-dir <dir>`;

const REPORT_ABSOLUTE_AND_DEFAULT =
  'Absolute --report is used as-is. Omit --report for ../runs/<runId>/ from that directory.\n';

const LOT7_HELP = `Lot 7: --dataset applies parameterized fill/select values (F-48). --repo is the
target project git root for assisted apply (F-64). PATCH_ASSISTED_APPLY defaults
false; only action.descriptor after 2 consecutive matching runs may open a
branch/PR. Never commit the default branch. Human review required.
`;

export function spyglassRunHelpText(): string {
  return `spyglass-run <scenario.json>
${F58_FLAGS}
${LOT7_FLAGS}

Relative --report is resolved from dirname(<scenario.json>), not process.cwd() (A19a).
${REPORT_ABSOLUTE_AND_DEFAULT}${LOT7_HELP}`;
}

export function generatedHelpText(): string {
  return `scenario.ts — Spyglass generated runner (visible by default)
${F58_FLAGS}
${LOT7_FLAGS}

Relative --report is resolved from the scenario directory (this script's folder), not process.cwd() (A19a).
${REPORT_ABSOLUTE_AND_DEFAULT}${LOT7_HELP}`;
}
