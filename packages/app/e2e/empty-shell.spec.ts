import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

/** @spyglass/app package root; `package.json` `"main"` is `./out/main/index.js`. */
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;

function launchEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  env.SPYGLASS_DISABLE_GPU = '1';
  env.SPYGLASS_NO_SANDBOX = '1';
  return env;
}

test.describe('Lot -1 empty Electron shell', () => {
  test('launches the electron-vite out/ build with bundled Electron', async () => {
    const electronApp = await electron.launch({
      cwd: appDir,
      args: ['--no-sandbox', '--no-zygote', appDir],
      executablePath: bundledElectron,
      timeout: 45_000,
      env: launchEnv()
    });

    try {
      const window = await electronApp.firstWindow({ timeout: 45_000 });
      await expect(window).toHaveTitle(/Spyglass/);
      await expect(window.locator('h1')).toHaveText('Spyglass');
      await expect(window.locator('.tagline')).toContainText('Lot -1');
      await expect(window.locator('#versions')).toContainText(/Electron/i);

      const shotDir = process.env.SPYGLASS_E2E_SCREENSHOT_DIR;
      if (shotDir !== undefined && shotDir.length > 0) {
        await window.screenshot({
          path: join(shotDir, 'e2e-empty-shell.png'),
          fullPage: true
        });
      }
    } finally {
      await electronApp.close();
    }
  });
});
