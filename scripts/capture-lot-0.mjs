import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'shell';

const shots = {
  shell: resolve(root, 'docs/lot-0/screenshots/two-zone-shell.png'),
  navigated: resolve(root, 'docs/lot-0/screenshots/navigated-webcontentsview.png'),
  observe: resolve(root, 'docs/lot-0/screenshots/stagehand-observe.png')
};

const out = shots[mode] ?? shots.shell;
mkdirSync(dirname(out), { recursive: true });

const env = {
  ...process.env,
  SPYGLASS_SCREENSHOT_PATH: out,
  SPYGLASS_SCREENSHOT_EXIT: '1',
  SPYGLASS_DISABLE_GPU: '1',
  SPYGLASS_NO_SANDBOX: '1'
};
delete env.ELECTRON_RENDERER_URL;

if (mode === 'navigated' || mode === 'observe') {
  env.SPYGLASS_START_URL = process.env.SPYGLASS_START_URL ?? 'https://example.com';
}
if (mode === 'observe') {
  env.SPYGLASS_OBSERVE_ON_START = '1';
}

const TIMEOUT_MS = mode === 'observe' ? 120_000 : 60_000;

const child = spawn('pnpm', ['--filter', '@spyglass/app', 'capture:shell'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

const timer = setTimeout(() => {
  console.error(`capture:lot-0 (${mode}) timed out after ${String(TIMEOUT_MS)}ms`);
  child.kill('SIGTERM');
  setTimeout(() => {
    child.kill('SIGKILL');
    process.exit(1);
  }, 2_000);
}, TIMEOUT_MS);

child.on('error', (error) => {
  clearTimeout(timer);
  console.error('capture:lot-0 failed to start:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code === null ? 1 : code);
});
