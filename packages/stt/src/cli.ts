#!/usr/bin/env node
import { runSidecarMain } from './sidecar.ts';

void runSidecarMain().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
