import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import type { MeasuredRates } from './corpus.ts';
import { localCorpusSites, measureCorpus, PUBLIC_CORPUS } from './corpus.ts';
import { startFixtureServer } from './http-fixture.ts';

export function resolveCorpusOutPath(argv: readonly string[], wave: MeasuredRates['wave']): string {
  const outIndex = argv.indexOf('--out');
  const outArg = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  if (outArg !== undefined && outArg.length > 0) {
    return resolve(outArg);
  }
  const file =
    wave === 'J+1'
      ? 'measured-rates.j1.json'
      : wave === 'local-immutable'
        ? 'measured-rates.local.json'
        : 'measured-rates.json';
  return resolve(repoRoot(), 'docs/lot-6', file);
}

export async function runCorpusCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const publicLive = argv.includes('--public');
  const wantsJ1 = argv.includes('--j1');
  if (wantsJ1 && !publicLive) {
    process.stderr.write('--j1 requires --public (J+1 is the public corpus wave)\n');
    return 2;
  }
  const wave = publicLive ? (wantsJ1 ? 'J+1' : 'J+0') : 'local-immutable';
  const out = resolveCorpusOutPath(argv, wave);
  let close: (() => Promise<void>) | undefined;
  try {
    let sites = [...PUBLIC_CORPUS];
    if (!publicLive) {
      const server = await startFixtureServer();
      close = () => server.close();
      sites = localCorpusSites(server.origin);
    }
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
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    try {
      await close?.();
    } catch {
      // close must not mask measure/write exit status
    }
  }
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  void runCorpusCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
