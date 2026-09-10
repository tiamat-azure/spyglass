#!/usr/bin/env node
/**
 * Fetch whisper.cpp CLI + ggml-small-q5_1 weights into vendor/whisper (ADR-0013).
 * Not run in CI: binaries/models are too heavy, and CI forces the mock engine.
 *
 * The result is what `resolveWhisperPaths` looks for and what electron-builder
 * ships as `resources/stt`: `whisper-cli` next to the shared libraries it needs
 * (the binary is linked with RUNPATH=$ORIGIN) and the model file.
 *
 * Usage:
 *   node scripts/fetch-whisper.mjs          # download what is missing
 *   node scripts/fetch-whisper.mjs --force  # re-download everything
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'vendor/whisper');
const force = process.argv.slice(2).includes('--force');

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin';
const MODEL_NAME = 'ggml-small-q5_1.bin';

/** Pinned like every other v1 dependency: bump deliberately, not by drift. */
const WHISPER_RELEASE = 'v1.9.2';
const RELEASE_BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}`;

/** @returns {{url: string, archive: string, bin: string} | undefined} */
function cliAsset() {
  const { platform, arch } = process;
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    const asset = `whisper-bin-ubuntu-${arch}.tar.gz`;
    return { url: `${RELEASE_BASE}/${asset}`, archive: asset, bin: 'whisper-cli' };
  }
  if (platform === 'win32' && arch === 'x64') {
    const asset = 'whisper-bin-x64.zip';
    return { url: `${RELEASE_BASE}/${asset}`, archive: asset, bin: 'whisper-cli.exe' };
  }
  // macOS publishes an xcframework, not a CLI: build whisper.cpp locally.
  return undefined;
}

/** Keeps the CLI and the libraries it dlopen()s; drops tests and other tools. */
function isWanted(name) {
  if (name === 'whisper-cli' || name === 'whisper-cli.exe' || name === 'LICENSE') return true;
  return /\.(?:so|dll|dylib)(?:\.\d+)*$/u.test(name);
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} -> ${String(response.status)}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

/** bsdtar reads .zip too, so one extractor covers Linux and Windows. */
function extract(archive, dir) {
  const result = spawnSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tar -xf ${archive} failed (${String(result.status ?? result.error)})`);
  }
}

/** @returns {Promise<string[]>} every file path under `dir`, recursively */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? await walk(path) : [path];
    })
  );
  return files.flat();
}

async function installCli() {
  const asset = cliAsset();
  if (asset === undefined) {
    process.stdout.write(
      `No prebuilt whisper-cli for ${process.platform}/${process.arch}.\n` +
        `Build whisper.cpp locally, then copy whisper-cli and its libraries into ${outDir}.\n`
    );
    return false;
  }
  const work = await mkdtemp(join(tmpdir(), 'spyglass-whisper-'));
  try {
    const archive = join(work, asset.archive);
    process.stdout.write(`Downloading ${asset.archive} (whisper.cpp ${WHISPER_RELEASE})...\n`);
    await download(asset.url, archive);
    extract(archive, work);
    let installed = 0;
    for (const file of await walk(work)) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (file === archive || !isWanted(name)) continue;
      const dest = join(outDir, name);
      await copyFile(file, dest);
      if (name.startsWith('whisper-cli')) await chmod(dest, 0o755);
      installed += 1;
    }
    if (!existsSync(join(outDir, asset.bin))) {
      throw new Error(`${asset.bin} not found in ${asset.archive} - release layout changed.`);
    }
    process.stdout.write(`Wrote ${String(installed)} files to ${outDir}\n`);
    return true;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const modelPath = join(outDir, MODEL_NAME);
  if (force || !existsSync(modelPath)) {
    process.stdout.write(`Downloading ${MODEL_NAME} (offline STT weights, ~190MB)...\n`);
    await download(MODEL_URL, modelPath);
    process.stdout.write(`Wrote ${modelPath} (${String((await stat(modelPath)).size)} bytes)\n`);
  } else {
    process.stdout.write(`${MODEL_NAME} already present, skipping (--force to re-download).\n`);
  }
  const bin = cliAsset()?.bin;
  if (!force && bin !== undefined && existsSync(join(outDir, bin))) {
    process.stdout.write(`${bin} already present, skipping (--force to re-download).\n`);
    return;
  }
  if (await installCli()) {
    process.stdout.write('Local dictation is ready: whisper is auto-selected on next launch.\n');
  }
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
