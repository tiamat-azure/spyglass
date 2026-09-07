import { describe, expect, it } from 'vitest';
import { RUNNER_PACKAGE, runnerPackageName } from './index.ts';

describe('@spyglass/runner scaffold', () => {
  it('reserves the npm scope name', () => {
    expect(runnerPackageName()).toBe('@spyglass/runner');
    expect(RUNNER_PACKAGE.startsWith('@spyglass/')).toBe(true);
  });
});
