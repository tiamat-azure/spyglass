import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Scenario } from '@spyglass/contracts';
import { RUNNER_PACKAGE } from './package-name.ts';
import { runPath } from './paths.ts';
import { loadScenarioFile, scenarioFromRevision } from './scenario.ts';

export const GENERATED_DIR_NAME = 'generated';
export const GENERATED_SCENARIO_JSON = 'scenario.json';
export const GENERATED_SCENARIO_TS = 'scenario.ts';
export const GENERATED_README = 'README.md';
export const GENERATED_PACKAGE_JSON = 'package.json';

export type WriteGeneratedPackageInput = {
  sessionDir: string;
  scenario: Scenario;
  runnerVersion?: string;
};

export type GeneratedPackagePaths = {
  dir: string;
  scenarioJson: string;
  scenarioTs: string;
  readme: string;
  packageJson: string;
};

export function generatedDir(sessionDir: string): string {
  return runPath(sessionDir, GENERATED_DIR_NAME);
}

export function generatedScenarioJsonPath(sessionDir: string): string {
  return runPath(generatedDir(sessionDir), GENERATED_SCENARIO_JSON);
}

export function npmPackageNameForSession(sessionId: string): string {
  const slug = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return `spyglass-scenario-${slug.length > 0 ? slug : 'session'}`;
}

/** Thin executable hybrid package (ADR-0006 / F-45 / PRD §6.12, §6.14). */
export async function writeGeneratedPackage(
  input: WriteGeneratedPackageInput
): Promise<GeneratedPackagePaths> {
  const dir = generatedDir(input.sessionDir);
  await mkdir(dir, { recursive: true });
  const scenarioJson = runPath(dir, GENERATED_SCENARIO_JSON);
  const scenarioTs = runPath(dir, GENERATED_SCENARIO_TS);
  const readme = runPath(dir, GENERATED_README);
  const packageJson = runPath(dir, GENERATED_PACKAGE_JSON);
  const version = input.runnerVersion ?? '0.0.0';
  const scenario: Scenario = {
    ...input.scenario,
    generatedAt: input.scenario.generatedAt ?? new Date().toISOString()
  };
  await writeFile(scenarioJson, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  await writeFile(scenarioTs, generatedScenarioTsSource(), 'utf8');
  await writeFile(readme, generatedReadme(scenario.sessionId), 'utf8');
  await writeFile(
    packageJson,
    `${JSON.stringify(generatedPackageManifest(scenario.sessionId, version), null, 2)}\n`,
    'utf8'
  );
  return { dir, scenarioJson, scenarioTs, readme, packageJson };
}

export type SessionRevisionLike = {
  sessionId: string;
  model?: string;
  createdAt?: string;
  status?: string;
  steps: Scenario['steps'];
};

export async function generateFromSessionDir(sessionDir: string): Promise<GeneratedPackagePaths> {
  const scenario = await loadFinalizedScenarioForGenerate(sessionDir);
  return await writeGeneratedPackage({ sessionDir, scenario });
}

export async function loadFinalizedScenarioForGenerate(sessionDir: string): Promise<Scenario> {
  const startUrl = await readSessionStartUrl(sessionDir);
  const refinedDir = join(sessionDir, 'refined');
  const files = (await readdir(refinedDir)).filter((name) => /^rev-\d+\.json$/u.test(name));
  files.sort(
    (left, right) => Number.parseInt(left.slice(4), 10) - Number.parseInt(right.slice(4), 10)
  );
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const name = files[index];
    if (name === undefined) {
      continue;
    }
    const revision = JSON.parse(
      await readFile(join(refinedDir, name), 'utf8')
    ) as SessionRevisionLike;
    if (revision.status === 'finalized' && revision.steps.length > 0) {
      return scenarioFromRevision(revision, startUrl);
    }
  }
  try {
    return await loadScenarioFile(generatedScenarioJsonPath(sessionDir), startUrl);
  } catch {
    throw new Error('no finalized revision to generate from');
  }
}

export async function readSessionStartUrl(sessionDir: string): Promise<string> {
  try {
    const meta = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf8')) as {
      startUrl?: string;
    };
    if (typeof meta.startUrl === 'string' && meta.startUrl.length > 0) {
      return meta.startUrl;
    }
  } catch {
    // unit tests may omit meta.json
  }
  return 'https://exemple.test/start';
}

export function generatedScenarioTsSource(): string {
  return `#!/usr/bin/env node
/**
 * Spyglass generated runner (ADR-0006 / F-45 / PRD §6.12).
 * scenario.json is the source of truth. This file is a thin executable that
 * imports runScenario from @spyglass/runner and forwards F-58 flags.
 * Visible by default; pass --headless for CI. --no-ai needs no API key.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from '${RUNNER_PACKAGE}';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(join(here, 'scenario.json'), 'utf8'));
const result = await runScenario(scenario, {
  headless: process.argv.includes('--headless'),
  argv: process.argv.slice(2),
  env: process.env,
  scriptDir: here
});
console.log(JSON.stringify({ exitCode: result.exitCode, runDir: result.runDir ?? '' }));
process.exit(result.exitCode);
`;
}

export function generatedPackageManifest(
  sessionId: string,
  runnerVersion: string
): Record<string, unknown> {
  return {
    name: npmPackageNameForSession(sessionId),
    version: '0.0.0',
    private: true,
    type: 'module',
    engines: { node: '24.20.0' },
    scripts: {
      start: 'node --experimental-transform-types scenario.ts --no-ai',
      headless: 'node --experimental-transform-types scenario.ts --headless --no-ai'
    },
    dependencies: {
      [RUNNER_PACKAGE]: runnerVersion
    }
  };
}

export function generatedReadme(sessionId: string): string {
  return `# Script généré Spyglass

Session \`${sessionId}\`. Artefact **hybride** (ADR-0006, PRD §6.12) :

| Fichier | Rôle |
| --- | --- |
| \`scenario.json\` | source de vérité du scénario raffiné |
| \`scenario.ts\` | script mince : importe \`${RUNNER_PACKAGE}\` \`runScenario\` |
| \`package.json\` | dépendance déclarée \`${RUNNER_PACKAGE}\` |
| \`README.md\` | ce mode d'emploi |

Le moteur (vérifications, tentatives, rattrapage, rapports) vit dans la
librairie, pas dans ce fichier. Corriger le runner n'exige pas de régénérer
tous les scénarios.

## Prérequis

- Node.js **24.20.0** (pin Spyglass v1)
- \`${RUNNER_PACKAGE}\` installé (dépendance déclarée, pas l'application Electron)

Depuis le monorepo Spyglass :

\`\`\`bash
pnpm add ${RUNNER_PACKAGE}@file:../../packages/runner
node --experimental-transform-types scenario.ts --no-ai
\`\`\`

Hors Spyglass, une fois le paquet publié :

\`\`\`bash
pnpm add ${RUNNER_PACKAGE}
node --experimental-transform-types scenario.ts --no-ai
\`\`\`

Windows : même commande. v1 exporte le runner en TypeScript ; Node 24.20.0
requiert \`--experimental-transform-types\` (propriétés de constructeur).
\`pnpm start\` / \`pnpm headless\` passent déjà ce flag.

## Exécution — visible par défaut (F-45)

Le navigateur est **visible** sauf si vous passez \`--headless\`.

\`\`\`bash
node --experimental-transform-types scenario.ts --no-ai
node --experimental-transform-types scenario.ts --headless --no-ai
\`\`\`

\`--no-ai\` désactive tout rattrapage LLM : **aucune clé d'API n'est requise**.
En CI, \`CI=1\` (ou \`true\` / \`yes\`) équivaut à \`--no-ai\` (F-60) ; \`--ai\`
le force. \`--no-ai\` gagne toujours.

## Paramètres (F-58)

| Flag | Effet |
| --- | --- |
| \`--headless\` | Chromium sans fenêtre |
| \`--base-url <url>\` | préfixe le \`startUrl\` |
| \`--timeout <ms>\` | timeout de vérification d'étape (défaut 10000) |
| \`--max-ai-retries <n>\` | tentatives de rattrapage (défaut 3 / \`MAX_AI_RETRIES\`) |
| \`--no-ai\` | aucun rattrapage, aucun appel LLM |
| \`--ai\` | force le rattrapage (même en CI) |
| \`--report <dir>\` | dossier du rapport (\`report.json\`) |
| \`--trace\` | écrit \`trace.zip\` (chemin Windows-safe) |

Rapports par défaut : \`../runs/<runId>/\` (arborescence de session PRD §6.14).

Variables d'environnement (amorçage, PRD §7) : \`LLM_SMART_*\` seulement si
\`--ai\` ; \`MAX_AI_RETRIES\` ; \`CI\`.

## Invariants

- L'IA n'est qu'un rattrapage borné. Jamais d'application automatique de patch
  (F-57, F-62–F-65 : lot 7, hors v1).
- Ne commitez pas de clés d'API. Le chemin \`--no-ai\` est mockable en CI.
`;
}
