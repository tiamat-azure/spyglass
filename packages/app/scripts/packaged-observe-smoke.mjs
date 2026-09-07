#!/usr/bin/env node
/**
 * Lot 0 packaged Observe smoke (D1).
 *
 * 1. Assert linux-unpacked contains the observe worker + unpacked Stagehand.
 * 2. Launch the packaged binary with SPYGLASS_CDP=1 and observe-on-start.
 *
 * Usage (after `pnpm --filter @spyglass/app package:linux`):
 *   node packages/app/scripts/packaged-observe-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const unpacked = join(appRoot, 'release', 'linux-unpacked');
const binary = join(unpacked, 'spyglass');
const resources = join(unpacked, 'resources');

function requirePath(label, path) {
  if (!existsSync(path)) {
    throw new Error(`Packaged Observe smoke missing ${label}: ${path}`);
  }
}

function assertUnpackedLayout() {
  requirePath('linux-unpacked binary', binary);
  requirePath('observe extraResource', join(resources, 'scripts', 'stagehand-observe.mjs'));
  const unpackedRoot = join(resources, 'app.asar.unpacked');
  requirePath(
    'unpacked Stagehand',
    join(unpackedRoot, 'node_modules', '@browserbasehq', 'stagehand', 'package.json')
  );
  requirePath(
    'unpacked playwright-core',
    join(unpackedRoot, 'node_modules', 'playwright-core', 'package.json')
  );
  requirePath('unpacked zod', join(unpackedRoot, 'node_modules', 'zod', 'package.json'));
  console.log('packaged Observe layout: ok');
}

async function launchObserveSmoke() {
  const userData = await mkdtemp(join(tmpdir(), 'spyglass-packaged-observe-'));
  const resultPath = join(userData, 'observe.json');
  const shotPath = join(userData, 'smoke.png');
  const env = {
    ...process.env,
    SPYGLASS_CDP: '1',
    SPYGLASS_OBSERVE_ON_START: '1',
    SPYGLASS_OBSERVE_REQUIRE_OK: '1',
    SPYGLASS_OBSERVE_RESULT: resultPath,
    SPYGLASS_SCREENSHOT_PATH: shotPath,
    SPYGLASS_SCREENSHOT_EXIT: '1',
    SPYGLASS_DISABLE_GPU: '1',
    SPYGLASS_NO_SANDBOX: '1',
    SPYGLASS_USER_DATA: userData
  };
  delete env.ELECTRON_RENDERER_URL;

  const code = await new Promise((resolve, reject) => {
    const child = spawn(binary, ['--no-sandbox', '--no-zygote'], {
      env,
      stdio: 'inherit'
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('packaged Observe smoke timed out'));
    }, 120_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode === null ? 1 : exitCode);
    });
  });

  if (code !== 0) {
    throw new Error(`packaged Observe smoke exited ${String(code)}`);
  }
  const raw = await readFile(resultPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed.ok !== true) {
    throw new Error(`packaged Observe did not succeed: ${raw}`);
  }
  await writeFile(join(userData, 'ok'), '1');
  console.log(
    `packaged Observe smoke: ok (${String(parsed.observations?.length ?? 0)} observations)`
  );
}

assertUnpackedLayout();
await launchObserveSmoke();
