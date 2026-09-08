import { describe, expect, it } from 'vitest';
import { asEditedVoiceTranscript } from './voice-transcript.ts';

describe('asEditedVoiceTranscript', () => {
  it('keeps a raw segment transcript', () => {
    expect(asEditedVoiceTranscript('  bonjour  ')).toBe('bonjour');
  });

  it('unwraps a gabarit prompt wrapper', () => {
    expect(
      asEditedVoiceTranscript("Tu as dicté : « Je vais cliquer sur Démarrer » (avant l'action)")
    ).toBe('Je vais cliquer sur Démarrer');
  });
});
