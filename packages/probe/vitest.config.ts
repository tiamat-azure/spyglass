import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'probe',
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
