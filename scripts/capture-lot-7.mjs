/**
 * Lot 7 evidence screenshots: assisted-apply git log, health.json, datasets.
 */
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import { createPlaywrightDriver } from '@spyglass/runner';

const root = repoRoot();
const shotDir = join(root, 'docs/lot-7/screenshots');
await mkdir(shotDir, { recursive: true });

const healthHtml = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Lot 7 health.json</title>
<style>
  body { font: 16px/1.4 ui-monospace, monospace; background: #0b1220; color: #e8eef8; padding: 2rem; }
  pre { background: #152038; padding: 1.25rem; border-radius: 10px; }
</style></head>
<body>
<h1>F-63 / F-65 health.json</h1>
<pre id="json">{
  "schemaVersion": 1,
  "sessionId": "ses_lot7",
  "status": "healthy",
  "appliedPatches": 1,
  "patchCandidates": []
}</pre>
<p>Two consecutive matching descriptors promoted an action.descriptor patch.
Verification/structure remain proposal-only (F-62 / CA-14).</p>
</body></html>`;

const gitHtml = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Lot 7 assisted branch</title>
<style>
  body { font: 16px/1.4 ui-monospace, monospace; background: #0b1220; color: #e8eef8; padding: 2rem; }
  pre { background: #152038; padding: 1.25rem; border-radius: 10px; }
</style></head>
<body>
<h1>F-64 dedicated branch (never main)</h1>
<pre>* spyglass/patch-ses_lot7-abc123  (HEAD)
  main                              (unchanged SHA)
PR prepared as draft. Human review required. CI green ≠ merge.
PATCH_ASSISTED_APPLY=true  --repo &lt;target-project&gt;</pre>
</body></html>`;

const dataHtml = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Lot 7 datasets</title>
<style>
  body { font: 16px/1.4 ui-monospace, monospace; background: #0b1220; color: #e8eef8; padding: 2rem; }
  pre { background: #152038; padding: 1.25rem; border-radius: 10px; }
</style></head>
<body>
<h1>F-48 distinct datasets</h1>
<pre>datasets/recorded.json  { "user": "alice", "password": "one" }
datasets/example.json   { "user": "example_user", "password": "" }
--dataset datasets/recorded.json  → fills alice / one
--dataset datasets/example.json   → fills example_user / (blank secret)
--dataset alt.json                → fills bob / two</pre>
</body></html>`;

const tmp = await mkdtemp(join(tmpdir(), 'spyglass-lot7-shots-'));
const files = [
  ['health.html', 'health-json.png', healthHtml],
  ['git.html', 'assisted-branch.png', gitHtml],
  ['data.html', 'datasets.png', dataHtml]
];
let driver;
try {
  driver = await createPlaywrightDriver({ headless: true, env: { ...process.env, CI: '1' } });
  for (const [htmlName, pngName, html] of files) {
    const htmlPath = join(tmp, htmlName);
    await writeFile(htmlPath, html, 'utf8');
    await driver.goto(pathToFileURL(htmlPath).href);
    await driver.screenshot(join(shotDir, pngName));
  }
} finally {
  await driver?.close();
  for (const [htmlName] of files) {
    await unlink(join(tmp, htmlName)).catch(() => undefined);
  }
  await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
}
