/**
 * Lot 6 evidence screenshots: generated tree, headed run, headless report, protocol snippet.
 */
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import {
  createPlaywrightDriver,
  runGeneratedScript,
  startFixtureServer,
  writeGeneratedPackage
} from '@spyglass/runner';

const root = repoRoot();
const shotDir = join(root, 'docs/lot-6/screenshots');
await mkdir(shotDir, { recursive: true });

let server;
let sessionDir;
let driver;
try {
  server = await startFixtureServer();
  sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-shots-'));
  const startUrl = `${server.origin}/lot6-fixture.html`;
  const scenario = {
    schemaVersion: 1,
    sessionId: 'ses_lot6_shots',
    startUrl,
    generatedAt: new Date().toISOString(),
    steps: [
      {
        index: 0,
        intent: 'Je clique sur Start',
        action: {
          type: 'click',
          descriptor: {
            type: 'click',
            selector: '[data-testid="go"]',
            selectorStrategy: 'testId'
          }
        },
        verification: {
          type: 'elementVisible',
          expected: '[data-testid="done"]',
          strength: 'strong',
          confirmedByUser: true,
          timeoutMs: 10_000
        },
        sourceEvents: ['evt_000001']
      }
    ]
  };

  const paths = await writeGeneratedPackage({ sessionDir, scenario });
  const generatedTs = await readFile(paths.scenarioTs, 'utf8');
  if (!generatedTs.includes("import { runScenario } from '@spyglass/runner'")) {
    throw new Error('generated scenario.ts must import runScenario (ADR-0006)');
  }
  if (generatedTs.includes('runGeneratedScript')) {
    throw new Error('generated scenario.ts must not import runGeneratedScript');
  }
  const treeHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Generated script tree</title>
    <style>
      body { font: 16px/1.4 ui-monospace, monospace; background: #0b1220; color: #e8eef8; padding: 2rem; }
      h1 { font-family: ui-sans-serif, sans-serif; }
      pre { background: #152038; padding: 1.25rem; border-radius: 10px; }
    </style>
  </head>
  <body>
    <h1>sessions/ses_lot6_shots/generated/</h1>
    <pre id="tree">generated/
  package.json     dependencies: @spyglass/runner
  README.md        mode d'emploi (F-45 / F-58)
  scenario.json    source de vérité
  scenario.ts      import { runScenario } from '@spyglass/runner'</pre>
  </body>
</html>`;
  await writeFile(join(shotDir, 'tree.html'), treeHtml, 'utf8');

  const env = {
    ...process.env,
    SPYGLASS_NO_SANDBOX: '1',
    SPYGLASS_DISABLE_GPU: '1'
  };
  delete env.LLM_SMART_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.CI;

  const headedEnv = { ...env, SPYGLASS_PROOF_SCREENSHOT: join(shotDir, 'headed-run.png') };
  const headed = await runGeneratedScript(
    scenario,
    ['--no-ai', '--timeout', '15000'],
    headedEnv,
    paths.dir
  );
  if (headed !== 0) {
    throw new Error(`headed run failed: ${String(headed)}`);
  }

  const headless = await runGeneratedScript(
    scenario,
    ['--headless', '--no-ai', '--timeout', '15000'],
    { ...env, CI: '1' },
    paths.dir
  );
  if (headless !== 0) {
    throw new Error(`headless run failed: ${String(headless)}`);
  }

  const ratesRaw = await readFile(join(root, 'docs/lot-6/measured-rates.j0.json'), 'utf8');
  const measured = JSON.parse(ratesRaw);
  const passed = measured.sites.filter((site) => site.ok).length;
  const compactRates = JSON.stringify(
    {
      wave: measured.wave,
      measuredAt: measured.measuredAt,
      replayWithoutAiRate: measured.replayWithoutAiRate,
      passed: `${String(passed)}/${String(measured.sites.length)}`,
      sites: measured.sites.map((site) => ({
        id: site.id,
        ok: site.ok,
        exitCode: site.exitCode,
        mode: site.mode
      }))
    },
    null,
    2
  );
  const protocol = await readFile(join(root, 'docs/lot-6/protocol.md'), 'utf8');
  const snippet = protocol.split('\n').slice(0, 22).join('\n');
  const protocolHtml = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>Lot 6 protocol + rates</title>
    <style>
      body { font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; background: #f7f9fc; color: #0b1220; padding: 1.5rem 2rem; max-width: 52rem; }
      pre { background: #0b1220; color: #e8eef8; padding: 1rem; border-radius: 8px; overflow: visible; white-space: pre-wrap; font-size: 12px; }
      h1, h2 { margin-bottom: 0.4rem; }
    </style>
  </head>
  <body>
    <h1>PRD §2.2 — protocole Lot 6</h1>
    <h2>J+0 public corpus (published rates)</h2>
    <pre id="rates">${compactRates.replaceAll('<', '&lt;')}</pre>
    <h2>Protocol excerpt</h2>
    <pre>${snippet.replaceAll('<', '&lt;')}</pre>
  </body>
</html>`;
  await writeFile(join(shotDir, 'protocol.html'), protocolHtml, 'utf8');

  const headlessHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Headless generated script</title>
    <style>
      body { font: 16px ui-monospace, monospace; background: #0b1220; color: #b6f3c8; padding: 2rem; }
      h1 { font-family: ui-sans-serif, sans-serif; color: #e8eef8; }
    </style>
  </head>
  <body>
    <h1>node --experimental-transform-types scenario.ts --headless --no-ai</h1>
    <p>exitCode: 0 · no API keys · outside Electron</p>
    <p>CI=1 · @spyglass/runner runScenario</p>
  </body>
</html>`;
  await writeFile(join(shotDir, 'headless.html'), headlessHtml, 'utf8');

  driver = await createPlaywrightDriver({
    headless: true,
    env: { ...process.env, SPYGLASS_NO_SANDBOX: '1', SPYGLASS_DISABLE_GPU: '1' }
  });
  await driver.goto(pathToFileURL(join(shotDir, 'tree.html')).href);
  await driver.screenshot(join(shotDir, 'generated-script-tree.png'));
  await driver.goto(pathToFileURL(join(shotDir, 'headless.html')).href);
  await driver.screenshot(join(shotDir, 'headless-run.png'));
  await driver.goto(pathToFileURL(join(shotDir, 'protocol.html')).href);
  await driver.screenshot(join(shotDir, 'corpus-protocol-snippet.png'), { fullPage: true });

  process.stdout.write(
    `screenshots written to ${shotDir}\nheaded=${String(headed)} headless=${String(headless)}\n`
  );
} finally {
  if (driver !== undefined) {
    try {
      await driver.close();
    } catch {
      // still remove temp dirs
    }
  }
  if (server !== undefined) {
    try {
      await server.close();
    } catch {
      // still remove temp dirs
    }
  }
  if (sessionDir !== undefined) {
    await rm(sessionDir, { recursive: true, force: true });
  }
  for (const name of ['tree.html', 'headless.html', 'protocol.html']) {
    await unlink(join(shotDir, name)).catch(() => undefined);
  }
}
