import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/contracts/vitest.config.ts',
      'packages/runner/vitest.config.ts',
      'packages/probe/vitest.config.ts',
      'packages/stt/vitest.config.ts',
      'packages/llm/vitest.config.ts',
      'packages/app/vitest.config.ts'
    ]
  }
});
