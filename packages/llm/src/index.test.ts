import { describe, expect, it } from 'vitest';
import {
  LLM_FAST_MODEL_DEFAULT,
  LLM_PACKAGE,
  LLM_SMART_MODEL_DEFAULT,
  llmPackageName,
  normalizeHttpOrHttpsUrl,
  pinSmartModel
} from './index.ts';

describe('@spyglass/llm public API', () => {
  it('exposes the reserved package name and the pinned fast model (I-03)', () => {
    expect(llmPackageName()).toBe(LLM_PACKAGE);
    expect(LLM_FAST_MODEL_DEFAULT).toBe('claude-haiku-4-5-20251001');
  });

  it('pins the smart model to a dated Sonnet snapshot (I-05)', () => {
    expect(LLM_SMART_MODEL_DEFAULT).toBe('claude-sonnet-4-5-20250929');
    expect(pinSmartModel('claude-sonnet-4-5')).toBe('claude-sonnet-4-5-20250929');
    expect(pinSmartModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('exports the chrome http(s) URL gate used by recovery sanitize', () => {
    expect(normalizeHttpOrHttpsUrl('https://exemple.test')).toBe('https://exemple.test/');
    expect(normalizeHttpOrHttpsUrl('javascript:alert(1)')).toBeUndefined();
  });
});
