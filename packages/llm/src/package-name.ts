/**
 * Two-profile LLM gateway, gabarits, expurgation, token budget (Lot 2).
 */
export const LLM_PACKAGE = '@spyglass/llm' as const;

export function llmPackageName(): typeof LLM_PACKAGE {
  return LLM_PACKAGE;
}
