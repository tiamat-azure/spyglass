/**
 * Danger-row « Relever le plafond » is the ceiling-halt CTA.
 * Warn-threshold raises (`data-banner="warning"`) stay clickable while halt is
 * still `none`. Only dismiss/disable stale danger CTAs after the ceiling is
 * cleared (halt !== 'ceiling') or a resume message is shown.
 */
export function isStaleCeilingRaiseCta(
  halt: string | undefined,
  banner: string | undefined
): boolean {
  return halt !== 'ceiling' && banner === 'danger';
}
