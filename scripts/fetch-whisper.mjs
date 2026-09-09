#!/usr/bin/env node
/**
 * Fetch whisper.cpp CLI + ggml-small-q5_1 weights for packaged/dev (ADR-0013).
 * Not run in CI — binaries/models are too heavy; the mock engine covers tests.
 *
 * Usage: node scripts/fetch-whisper.mjs [--large]
 *
 * L7-086: the default (non-`--large`) path uses only Node builtins so a plain
 * `node` invocation does not fail at import time. `--large` dynamically imports
 * the STT TypeScript modules (Node 24 type stripping).
 * W18a: `--large` ensures `ggml-small-q5_1.bin` (F-39 fallback) before returning.
 * C26a: `--large` also ensures whisper-cli (same as a plain fetch), not models-only.
 * W28b: `cliAsset()` is `.zip` on Windows (and darwin). `extractArchive` is
 * format-aware — Expand-Archive for zip on win32, not always `tar -xf`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, createWriteStream, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'vendor/whisper');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin';
const MODEL_NAME = 'ggml-small-q5_1.bin';
/** Skip empty/HTML stubs; a real whisper-cli binary is well above this. */
const CLI_MIN_BYTES = 10_000;

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

function existingCliOk(dest) {
  try {
    const st = statSync(dest);
    return st.isFile() && st.size >= CLI_MIN_BYTES;
  } catch {
    return false;
  }
}

function findNamedFile(dir, name) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    let names;
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of names) {
      const path = join(current, entry);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (st.isFile() && entry === name) {
        return path;
      }
    }
  }
  return undefined;
}

function spawnExtract(command, args, failLabel, extraEnv) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: extraEnv === undefined ? process.env : { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) {
    const detail = (
      result.error?.message ||
      result.stderr ||
      result.stdout ||
      String(result.status)
    ).trim();
    throw new Error(`${failLabel}: ${detail}`);
  }
}

function extractTar(archivePath, extractDir) {
  spawnExtract('tar', ['-xf', archivePath, '-C', extractDir], 'tar extract failed');
}

function extractZip(archivePath, extractDir) {
  if (process.platform === 'win32') {
    spawnExtract(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Expand-Archive -LiteralPath $env:SPYGLASS_WHISPER_ZIP -DestinationPath $env:SPYGLASS_WHISPER_OUT -Force'
      ],
      'zip extract failed',
      {
        SPYGLASS_WHISPER_ZIP: archivePath,
        SPYGLASS_WHISPER_OUT: extractDir
      }
    );
    return;
  }
  const unzip = spawnSync('unzip', ['-o', '-q', archivePath, '-d', extractDir], {
    encoding: 'utf8'
  });
  if (unzip.status === 0) {
    return;
  }
  extractTar(archivePath, extractDir);
}

/** W28b: zip when `cliAsset()` yields `.zip` (win32/darwin); tar for `.tar.gz`. */
function extractArchive(archivePath, extractDir) {
  if (/\.zip$/i.test(archivePath)) {
    extractZip(archivePath, extractDir);
    return;
  }
  extractTar(archivePath, extractDir);
}

/**
 * C26a: plain fetch and `--large` both leave a usable whisper-cli when a
 * prebuilt URL exists. Skip only a valid existing binary.
 */
async function ensureWhisperCli() {
  const cli = cliAsset();
  if (cli === undefined) {
    process.stdout.write(
      'No prebuilt whisper-cli URL for this platform. Build whisper.cpp and copy whisper-cli into vendor/whisper/.\n'
    );
    return;
  }
  const dest = join(outDir, cli.name);
  if (existingCliOk(dest)) {
    process.stdout.write(`whisper-cli already present: ${dest}\n`);
    return;
  }
  await rm(dest, { recursive: true, force: true });
  const archiveName = cli.url.split('/').pop() ?? 'whisper-cli-archive';
  const archivePath = join(outDir, `.${archiveName}`);
  process.stdout.write(`Downloading ${cli.name}…\n`);
  const extractDir = await mkdtemp(join(outDir, '.whisper-cli-'));
  try {
    await download(cli.url, archivePath);
    extractArchive(archivePath, extractDir);
    const found = findNamedFile(extractDir, cli.name);
    if (found === undefined) {
      throw new Error(`archive did not contain ${cli.name}`);
    }
    copyFileSync(found, dest);
    if (!existingCliOk(dest)) {
      await rm(dest, { recursive: true, force: true });
      throw new Error(`extracted ${cli.name} is smaller than ${String(CLI_MIN_BYTES)} bytes`);
    }
    if (process.platform !== 'win32') {
      chmodSync(dest, 0o755);
    }
    process.stdout.write(`Wrote ${dest}\n`);
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined);
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Reject truncated HTML/error bodies; real ggml-small-q5_1.bin is ~190MB. */
const SMALL_MIN_BYTES = 1_000_000;

function existingSmallOk(dest) {
  try {
    const st = statSync(dest);
    return st.isFile() && st.size >= SMALL_MIN_BYTES;
  } catch {
    return false;
  }
}

/** L7-229: skip only a valid large file; truncated files/dirs are re-fetched. */
function existingLargeOk(dest, minBytes) {
  try {
    const st = statSync(dest);
    return st.isFile() && st.size >= minBytes;
  } catch {
    return false;
  }
}

/** W18a / L7-179: skip only a valid small file; truncated files/dirs are re-fetched atomically. */
async function ensureSmallFallback(downloadAtomic) {
  const dest = join(outDir, MODEL_NAME);
  if (existingSmallOk(dest)) {
    process.stdout.write(`F-39 fallback already present: ${dest}\n`);
    return;
  }
  await rm(dest, { recursive: true, force: true });
  process.stdout.write(`Downloading ${MODEL_NAME} (F-39 fallback, ~190MB)…\n`);
  const response = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`GET ${MODEL_URL} → ${String(response.status)}`);
  }
  await downloadAtomic({
    dest,
    response,
    minBytes: SMALL_MIN_BYTES
  });
  process.stdout.write(`Wrote ${dest}\n`);
}

async function main() {
  const large = process.argv.includes('--large');
  await mkdir(outDir, { recursive: true });
  if (large) {
    const { downloadResponseToFileAtomic, STT_LARGE_DOWNLOAD_TIMEOUT_MS, STT_LARGE_MIN_BYTES } =
      await import('../packages/stt/src/download-model.ts');
    const { STT_LARGE_MODEL_FILE, STT_LARGE_MODEL_URL, STT_LARGE_SHA256 } = await import(
      '../packages/stt/src/upgrade.ts'
    );
    const largePath = join(outDir, STT_LARGE_MODEL_FILE);
    if (existingLargeOk(largePath, STT_LARGE_MIN_BYTES)) {
      process.stdout.write(`large already present: ${largePath}\n`);
    } else {
      process.stdout.write(`Downloading ${STT_LARGE_MODEL_FILE} (optional STT upgrade, ~575MB)…\n`);
      const response = await fetch(STT_LARGE_MODEL_URL, {
        redirect: 'follow',
        signal: AbortSignal.timeout(STT_LARGE_DOWNLOAD_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(`GET ${STT_LARGE_MODEL_URL} → ${String(response.status)}`);
      }
      await downloadResponseToFileAtomic({
        dest: largePath,
        response,
        expectedSha256: STT_LARGE_SHA256,
        minBytes: STT_LARGE_MIN_BYTES
      });
      process.stdout.write(`Wrote ${largePath}\n`);
    }
    await ensureSmallFallback(downloadResponseToFileAtomic);
    await ensureWhisperCli();
    return;
  }
  const modelPath = join(outDir, MODEL_NAME);
  process.stdout.write(`Downloading ${MODEL_NAME} (offline STT weights, ~190MB)…\n`);
  await download(MODEL_URL, modelPath);
  process.stdout.write(`Wrote ${modelPath}\n`);
  await ensureWhisperCli();
  process.stdout.write(
    'Then launch with SPYGLASS_STT_ENGINE=whisper (auto-selected when both files exist).\n'
  );
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
