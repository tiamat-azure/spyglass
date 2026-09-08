import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import { localCorpusSites, measureCorpus, PUBLIC_CORPUS } from './corpus.ts';
import { startFixtureServer } from './http-fixture.ts';

export async function runCorpusCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const publicLive = argv.includes('--public');
  const wave = publicLive ? (argv.includes('--j1') ? 'J+1' : 'J+0') : 'local-immutable';
  const outIndex = argv.indexOf('--out');
  const outArg = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const out =
    outArg !== undefined && outArg.length > 0
      ? resolve(outArg)
      : resolve(repoRoot(), 'docs/lot-6/measured-rates.json');
  let close: (() => Promise<void>) | undefined;
  let sites = [...PUBLIC_CORPUS];
  if (!publicLive) {
    const server = await startFixtureServer();
    close = () => server.close();
    sites = localCorpusSites(server.origin);
  }
  try {
    const measured = await measureCorpus({
      sites,
      wave,
      reportRoot: resolve(repoRoot(), 'docs/lot-6/corpus-runs'),
      env,
      headless: true
    });
    await writeFile(out, `${JSON.stringify(measured, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ out, rate: measured.replayWithoutAiRate })}\n`);
    return measured.sites.every((row) => row.ok) ? 0 : 1;
  } finally {
    await close?.();
  }
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  void runCorpusCli().then((code) => {
    process.exit(code);
  });
}
