import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '@spyglass/contracts';
import type { MeasuredRates } from './corpus.ts';
import { localCorpusSites, measureCorpus, PUBLIC_CORPUS } from './corpus.ts';
import { startFixtureServer } from './http-fixture.ts';

function isInsideDir(dir: string, targetPath: string): boolean {
  const root = resolve(dir);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Realpath the deepest existing ancestor so a symlink cannot jailbreak O34a. */
async function realpathExistingPrefix(targetPath: string): Promise<string> {
  const resolved = resolve(targetPath);
  const missing: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length === 0 ? real : resolve(real, ...missing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

export function corpusOutFlagMissing(argv: readonly string[]): boolean {
  const outIndex = argv.indexOf('--out');
  if (outIndex < 0) {
    return false;
  }
  const outArg = argv[outIndex + 1];
  return outArg === undefined || outArg.length === 0 || outArg.startsWith('-');
}

export async function resolveCorpusOutPath(
  argv: readonly string[],
  wave: MeasuredRates['wave']
): Promise<string> {
  if (corpusOutFlagMissing(argv)) {
    throw new Error('--out requires a path');
  }
  const outIndex = argv.indexOf('--out');
  const outArg = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const resolved =
    outArg !== undefined && outArg.length > 0
      ? isAbsolute(outArg)
        ? resolve(outArg)
        : resolve(repoRoot(), outArg)
      : resolve(
          repoRoot(),
          'docs/lot-6',
          wave === 'J+1'
            ? 'measured-rates.j1.json'
            : wave === 'local-immutable'
              ? 'measured-rates.local.json'
              : 'measured-rates.json'
        );
  return await jailCorpusOutPath(resolved);
}

/** O34a / L6-075: jail on the realpath leaf, not the pre-realpath string. */
async function jailCorpusOutPath(candidate: string): Promise<string> {
  const rootReal = await realpath(resolve(repoRoot()));
  const lot6Real = await realpathExistingPrefix(resolve(repoRoot(), 'docs/lot-6'));
  const realTarget = await realpathExistingPrefix(candidate);
  if (!isInsideDir(rootReal, realTarget)) {
    throw new Error(`--out path escapes the repo: ${candidate}`);
  }
  if (!isInsideDir(lot6Real, realTarget) || resolve(realTarget) === resolve(lot6Real)) {
    throw new Error(`--out path escapes docs/lot-6: ${candidate}`);
  }
  if (!candidate.toLowerCase().endsWith('.json') || !realTarget.toLowerCase().endsWith('.json')) {
    throw new Error('--out must be a .json file under docs/lot-6');
  }
  return realTarget;
}

/** Re-realpath after the check/use gap; reject if the jailed target moved. */
async function commitCorpusOutWritePath(validatedReal: string): Promise<string> {
  const realNow = await jailCorpusOutPath(validatedReal);
  if (resolve(realNow) !== resolve(validatedReal)) {
    throw new Error('--out path changed after validation');
  }
  return realNow;
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
  if (corpusOutFlagMissing(argv)) {
    process.stderr.write('--out requires a path\n');
    return 2;
  }
  const wave = publicLive ? (wantsJ1 ? 'J+1' : 'J+0') : 'local-immutable';
  let close: (() => Promise<void>) | undefined;
  try {
    let out = await resolveCorpusOutPath(argv, wave);
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
    out = await commitCorpusOutWritePath(out);
    await mkdir(dirname(out), { recursive: true });
    out = await commitCorpusOutWritePath(out);
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
