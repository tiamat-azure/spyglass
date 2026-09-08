const GABARIT = /^Tu as dicté : « (.+) »(?: \([^)]+\))?\s*$/u;

/** Keep the raw segment transcript; unwrap a gabarit if the UI submitted one. */
export function asEditedVoiceTranscript(raw: string): string {
  const trimmed = raw.trim();
  const match = GABARIT.exec(trimmed);
  return match?.[1] ?? trimmed;
}
