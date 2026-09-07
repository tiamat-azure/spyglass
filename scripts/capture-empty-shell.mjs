import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'docs/lot-m1/screenshots/empty-electron-shell.png');
mkdirSync(dirname(out), { recursive: true });

const env = {
  ...process.env,
  SPYGLASS_SCREENSHOT_PATH: out,
  SPYGLASS_SCREENSHOT_EXIT: '1',
  SPYGLASS_DISABLE_GPU: '1',
  SPYGLASS_NO_SANDBOX: '1'
};

const TIMEOUT_MS = 60_000;

const child = spawn('pnpm', ['--filter', '@spyglass/app', 'capture:shell'], {
  cwd: root,
  env,
  stdio: 'inherit'
});

const timer = setTimeout(() => {
  console.error(`capture:shell timed out after ${String(TIMEOUT_MS)}ms`);
  child.kill('SIGTERM');
  setTimeout(() => {
    child.kill('SIGKILL');
    process.exit(1);
  }, 2_000);
}, TIMEOUT_MS);

child.on('error', (error) => {
  clearTimeout(timer);
  console.error('capture:shell failed to start:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code === null ? 1 : code);
});
