import { runSidecarMain } from '@spyglass/stt';

void runSidecarMain().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
