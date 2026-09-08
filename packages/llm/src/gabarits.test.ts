import { describe, expect, it } from 'vitest';
import { gabaritText, isEnrichableKind } from './gabarits.ts';

const ALL_KINDS = [
  'dom.click',
  'dom.dblclick',
  'dom.input',
  'dom.change',
  'dom.check',
  'dom.select',
  'dom.submit',
  'dom.key',
  'dom.scroll',
  'nav.load',
  'nav.spa',
  'nav.redirect',
  'nav.back',
  'nav.forward',
  'nav.popup-redirected',
  'net.request',
  'selection.text',
  'selection.value',
  'voice.partial',
  'voice.final',
  'voice.edited',
  'agent.message',
  'agent.narration-mode',
  'user.message',
  'record.start',
  'record.pause',
  'record.resume',
  'record.stop',
  'step.retracted'
] as const;

describe('gabarits (I-04)', () => {
  it('covers every raw-event kind with a French sentence, never a field value', () => {
    for (const kind of ALL_KINDS) {
      const text = gabaritText({
        kind,
        target: { role: 'button', accessibleName: 'Se connecter', text: 'Se connecter' },
        value: { masked: false, text: 'hunter2-secret' },
        page: { url: 'https://exemple.fr/login?token=abcd', title: 'Connexion' },
        key: 'Enter'
      });
      expect(text.length).toBeGreaterThan(3);
      expect(text).not.toContain('hunter2-secret');
      expect(text).not.toContain('https://');
      expect(text).not.toBe(kind);
    }
  });

  it('uses second person for clicks and never dumps secrets', () => {
    expect(
      gabaritText({
        kind: 'dom.click',
        target: { accessibleName: 'Se connecter' }
      })
    ).toBe('Tu as cliqué sur « Se connecter »');
    expect(
      gabaritText({
        kind: 'dom.check',
        target: { accessibleName: 'CGU' },
        value: { masked: false, text: 'false' }
      })
    ).toBe('Tu as décoché « CGU »');
  });

  it('marks capture events as enrichable and control events as local-only', () => {
    expect(isEnrichableKind('dom.click')).toBe(true);
    expect(isEnrichableKind('nav.load')).toBe(true);
    expect(isEnrichableKind('record.start')).toBe(false);
    expect(isEnrichableKind('agent.narration-mode')).toBe(false);
  });
});
