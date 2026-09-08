#!/usr/bin/env node
/**
 * Launches Electron through electron-vite (`dev`, `preview`) or directly
 * (`app`), forwarding the Chromium sandbox switches when
 * `SPYGLASS_NO_SANDBOX=1`.
 *
 * `app.commandLine.appendSwitch('no-sandbox')` in the main process is too late:
 * Chromium initialises the SUID sandbox before the main bundle is evaluated, so
 * the environment variable alone leaves `pnpm dev` aborting with
 * `The SUID sandbox helper binary was found, but is not configured correctly`.
 * Playwright e2e already passes `--no-sandbox --no-zygote` as argv for the same
 * reason; this keeps the dev, preview, and capture paths consistent with it.
 */
import { spawn } from 'node:child_process';

const MODES = new Set(['dev', 'preview', 'app']);
const mode = process.argv[2];
if (mode === undefined || !MODES.has(mode)) {
  console.error('usage: run-electron.mjs <dev|preview|app> [args...]');
  process.exit(2);
}

const passthrough = process.argv.slice(3);
const sandboxOff = process.env.SPYGLASS_NO_SANDBOX === '1' || process.env.CI === 'true';
const sandboxArgs = sandboxOff ? ['--no-sandbox', '--no-zygote'] : [];

const command = mode === 'app' ? 'electron' : 'electron-vite';
const args =
  mode === 'app'
    ? [...sandboxArgs, ...(passthrough.length > 0 ? passthrough : ['.'])]
    : [mode, ...passthrough, ...(sandboxArgs.length > 0 ? ['--', ...sandboxArgs] : [])];

const child = spawn(command, args, { stdio: 'inherit', shell: false });
child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
