import { describe, expect, it } from 'vitest';
import { LLM_FAST_MODEL_DEFAULT, LLM_PACKAGE, llmPackageName } from './index.ts';

describe('@spyglass/llm public API', () => {
  it('exposes the reserved package name and the pinned fast model (I-03)', () => {
    expect(llmPackageName()).toBe(LLM_PACKAGE);
    expect(LLM_FAST_MODEL_DEFAULT).toBe('claude-haiku-4-5-20251001');
  });
});
