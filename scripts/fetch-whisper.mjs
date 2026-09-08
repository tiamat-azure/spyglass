#!/usr/bin/env node
/**
 * Fetch whisper.cpp CLI + ggml-small-q5_1 weights for packaged/dev (ADR-0013).
 * Not run in CI — binaries/models are too heavy; the mock engine covers tests.
 *
 * Usage: node scripts/fetch-whisper.mjs
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'vendor/whisper');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin';
const MODEL_NAME = 'ggml-small-q5_1.bin';

function cliAsset() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return {
      url: `https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.5/whisper-bin-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`,
      name: 'whisper-cli'
    };
  }
  if (plat === 'darwin') {
    return {
      url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.5/whisper-bin-x64.zip',
      name: 'whisper-cli'
    };
  }
  if (plat === 'win32') {
    return {
      url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.5/whisper-bin-x64.zip',
      name: 'whisper-cli.exe'
    };
  }
  return undefined;
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} → ${String(response.status)}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const modelPath = join(outDir, MODEL_NAME);
  process.stdout.write(`Downloading ${MODEL_NAME} (offline STT weights, ~190MB)…\n`);
  await download(MODEL_URL, modelPath);
  process.stdout.write(`Wrote ${modelPath}\n`);
  const cli = cliAsset();
  if (cli === undefined) {
    process.stdout.write(
      'No prebuilt whisper-cli URL for this platform. Build whisper.cpp and copy whisper-cli into vendor/whisper/.\n'
    );
    return;
  }
  process.stdout.write(
    `Prebuilt CLI URL (manual extract if the archive layout changes):\n  ${cli.url}\nPlace the binary at vendor/whisper/${cli.name}\n`
  );
  process.stdout.write(
    'Then launch with SPYGLASS_STT_ENGINE=whisper (auto-selected when both files exist).\n'
  );
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
