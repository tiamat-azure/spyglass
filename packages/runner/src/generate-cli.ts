import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateFromSessionDir } from './generate.ts';

export async function runGenerateCli(
  argv: readonly string[] = process.argv.slice(2)
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: spyglass-generate <sessionDir>\n');
    return 0;
  }
  const sessionDir = argv.find((arg) => !arg.startsWith('-'));
  if (sessionDir === undefined) {
    process.stdout.write('Usage: spyglass-generate <sessionDir>\n');
    return 2;
  }
  const paths = await generateFromSessionDir(resolve(sessionDir));
  process.stdout.write(`${JSON.stringify({ ok: true, dir: paths.dir })}\n`);
  return 0;
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  void runGenerateCli().then((code) => {
    process.exit(code);
  });
}
