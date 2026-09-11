import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === 'true' ? 1 : 0,
  expect: {
    timeout: 10_000
  },
  use: {
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 20_000
  }
});

export default config;
