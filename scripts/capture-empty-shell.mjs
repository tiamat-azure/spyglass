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

const child = spawn('pnpm', ['--filter', '@spyglass/app', 'capture:shell'], {
  cwd: root,
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code === null ? 1 : code);
});
