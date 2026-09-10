#!/usr/bin/env node
/**
 * Spyglass preflight doctor.
 *
 * Checks the two failure modes that break `pnpm dev` / `pnpm build` with error
 * messages that do not name their real cause:
 *
 *  1. Incomplete pnpm install: a workspace `@spyglass/*` link is missing from a
 *     package's `node_modules`, so Rollup reports
 *     `Rollup failed to resolve import "@spyglass/llm"` at build time.
 *  2. Linux Electron SUID sandbox: distributions that set
 *     `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04+) force
 *     Electron onto `chrome-sandbox`, which pnpm installs as a normal user, so
 *     Chromium aborts with `The SUID sandbox helper binary was found, but is
 *     not configured correctly`.
 *
 * Usage:
 *   node scripts/doctor.mjs                # every applicable check
 *   node scripts/doctor.mjs --deps         # workspace links only
 *   node scripts/doctor.mjs --fix-sandbox  # chown root + chmod 4755 chrome-sandbox
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const depsOnly = args.has('--deps');
const fixSandbox = args.has('--fix-sandbox');

/** @returns {string[]} absolute paths of every workspace package directory */
function workspacePackages() {
  const packagesDir = join(root, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name))
    .filter((dir) => existsSync(join(dir, 'package.json')));
}

/** @returns {string[]} human-readable problems with `workspace:` links */
function checkWorkspaceLinks() {
  const problems = [];
  for (const dir of workspacePackages()) {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [name, spec] of Object.entries(declared)) {
      if (!String(spec).startsWith('workspace:')) continue;
      const linked = join(dir, 'node_modules', ...name.split('/'));
      if (!existsSync(linked)) {
        problems.push(`${manifest.name}: missing ${name} (expected ${linked})`);
      }
    }
  }
  return problems;
}

/** @returns {string | undefined} absolute path of the Electron chrome-sandbox helper */
function chromeSandboxPath() {
  const electronPath = join(root, 'node_modules', 'electron', 'dist', 'electron');
  if (!existsSync(electronPath)) return undefined;
  const candidate = join(dirname(electronPath), 'chrome-sandbox');
  return existsSync(candidate) ? candidate : undefined;
}

/** @returns {boolean} true when the kernel denies unprivileged user namespaces */
function userNamespacesRestricted() {
  const knobs = [
    ['/proc/sys/kernel/apparmor_restrict_unprivileged_userns', '1'],
    ['/proc/sys/kernel/unprivileged_userns_clone', '0']
  ];
  return knobs.some(([file, deny]) => {
    try {
      return readFileSync(file, 'utf8').trim() === deny;
    } catch {
      return false;
    }
  });
}

/** @returns {string[]} human-readable problems with the Electron sandbox */
function checkElectronSandbox() {
  if (process.platform !== 'linux') return [];
  if (process.env.CI === 'true' || process.env.SPYGLASS_NO_SANDBOX === '1') return [];
  if (!userNamespacesRestricted()) return [];

  const sandbox = chromeSandboxPath();
  if (sandbox === undefined) return [];

  const stats = statSync(sandbox);
  const setuidRoot = stats.uid === 0 && (stats.mode & 0o4000) !== 0;
  if (setuidRoot) return [];

  return [
    `Electron SUID sandbox is not configured: ${sandbox}`,
    'This kernel restricts unprivileged user namespaces, so Chromium needs the',
    'setuid helper and aborts without it.'
  ];
}

/**
 * @returns {string[]} warning lines when the local whisper.cpp engine is absent
 * (dictation then refuses to start instead of emitting canned transcripts).
 */
function checkWhisperEngine() {
  const dir = join(root, 'vendor', 'whisper');
  const bin = ['whisper-cli', 'whisper-cli.exe'].some((name) => existsSync(join(dir, name)));
  const model = existsSync(join(dir, 'ggml-small-q5_1.bin'));
  if (bin && model) return [];
  const missing = [!bin && 'whisper-cli', !model && 'ggml-small-q5_1.bin'].filter(Boolean);
  return [`vendor/whisper: missing ${missing.join(' and ')}`];
}

/** Applies the one-time root ownership the Electron SUID helper needs. */
function applySandboxFix() {
  const sandbox = chromeSandboxPath();
  if (sandbox === undefined) {
    console.error('doctor: chrome-sandbox not found — run `pnpm install` first.');
    return 1;
  }
  console.log(`doctor: configuring ${sandbox} (sudo required)`);
  const result = spawnSync(
    'sudo',
    ['sh', '-c', `chown root:root '${sandbox}' && chmod 4755 '${sandbox}'`],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error('doctor: sandbox fix failed.');
    return result.status ?? 1;
  }
  console.log('doctor: sandbox configured. Re-run after every `pnpm install`.');
  return 0;
}

if (fixSandbox) {
  process.exit(applySandboxFix());
}

const linkProblems = checkWorkspaceLinks();
const sandboxProblems = depsOnly ? [] : checkElectronSandbox();
const whisperWarnings = depsOnly ? [] : checkWhisperEngine();

if (linkProblems.length > 0) {
  console.error('doctor: incomplete pnpm install — workspace links are missing:');
  for (const problem of linkProblems) console.error(`  - ${problem}`);
  console.error('\nFix:\n  pnpm install\n');
}

if (sandboxProblems.length > 0) {
  console.error('doctor: Electron cannot start under this kernel:');
  for (const line of sandboxProblems) console.error(`  ${line}`);
  console.error('\nFix (one sudo call, repeat after every `pnpm install`):');
  console.error('  pnpm fix:sandbox');
  console.error('\nOr run without the Chromium sandbox (development only, less secure):');
  console.error('  SPYGLASS_NO_SANDBOX=1 pnpm dev\n');
}

if (whisperWarnings.length > 0) {
  console.warn('doctor: local dictation (STT) is unavailable (everything else still works):');
  for (const line of whisperWarnings) console.warn(`  ${line}`);
  console.warn('\nFix:\n  node scripts/fetch-whisper.mjs\n');
}

process.exit(linkProblems.length + sandboxProblems.length > 0 ? 1 : 0);
