import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const unpackedLinux = join(appDir, 'release/linux-unpacked/spyglass');
const require = createRequire(import.meta.url);
const bundledElectron = require('electron') as string;

test.describe('Lot -1 empty Electron shell', () => {
  test('launches the built app and shows the empty shell', async () => {
    const linuxBinary = existsSync(unpackedLinux);
    const electronApp = await electron.launch({
      cwd: appDir,
      args: linuxBinary ? ['--no-sandbox', '--no-zygote'] : ['--no-sandbox', '--no-zygote', appDir],
      executablePath: linuxBinary ? unpackedLinux : bundledElectron,
      timeout: 45_000,
      env: {
        ...process.env,
        SPYGLASS_DISABLE_GPU: '1',
        SPYGLASS_NO_SANDBOX: '1'
      }
    });

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

    await electronApp.close();
  });
});
