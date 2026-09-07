/**
 * STT sidecar scaffold (Lot -1).
 * whisper.cpp is not bundled yet; licence compatibility is documented in
 * docs/LICENSES-whisper.md before the first product package that ships weights.
 */
export const STT_PACKAGE = '@spyglass/stt' as const;
export const STT_SIDECAR_STATUS = 'scaffold' as const;

export function sidecarStatus(): typeof STT_SIDECAR_STATUS {
  return STT_SIDECAR_STATUS;
}
