import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'llm',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/expurgate.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90
      }
    }
  }
});
