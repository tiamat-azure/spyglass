import { describe, expect, it } from 'vitest';
import type { RawEvent } from './types.ts';

describe('schema-aligned contract types', () => {
  it('accepts a full raw-event payload including previously omitted fields', () => {
    const event = {
      schemaVersion: 1,
      id: 'evt_000321',
      sessionId: 'ses_typecheck',
      ts: 1_757_200_000_123,
      kind: 'voice.final',
      stepIndex: 4,
      pageId: 'page_main',
      page: { url: 'https://app.example.test', title: 'Demo' },
      target: {
        tag: 'button',
        id: 'login-submit',
        testId: 'submit',
        testAttributes: { 'data-testid': 'submit', 'data-qa': 'login' },
        role: 'button',
        accessibleName: 'Se connecter',
        text: 'Se connecter',
        name: 'submit',
        cssSelector: 'button#login-submit',
        xpath: '//button[@id="login-submit"]',
        siblingIndex: 2,
        ancestors: ['form', 'main'],
        framePath: ['main', '#consent-iframe'],
        shadowPath: ['my-widget'],
        boundingBox: { x: 12, y: 40, w: 160, h: 32 }
      },
      value: { masked: false, text: 'ok' },
      action: {
        type: 'click',
        selector: '[data-testid="submit"]',
        selectorStrategy: 'testId',
        description: 'Clic sur « Se connecter »'
      },
      narration: { mode: 'template', text: 'Clic' },
      voice: {
        text: 'je me connecte',
        startTs: 1_757_200_000_000,
        endTs: 1_757_200_000_800,
        editedFrom: 'evt_000320',
        audioRef: null
      },
      snapshotRef: 'snap_000321',
      screenshotRef: 'shot_000321'
    } satisfies RawEvent;

    expect(event.target?.testAttributes?.['data-qa']).toBe('login');
    expect(event.target?.siblingIndex).toBe(2);
    expect(event.target?.ancestors).toEqual(['form', 'main']);
    expect(event.target?.boundingBox?.w).toBe(160);
    expect(event.voice?.audioRef).toBeNull();
  });
});
