import { describe, expect, it } from 'vitest';
import {
  InputAggregator,
  isLabelClickForControlChange,
  isRedundantClickBeforeChange,
  shouldCaptureScroll
} from './denoise.ts';
import { INPUT_AGGREGATION_MS, PROBE_PACKAGE, probePackageName } from './index.ts';
import { maskCapturedValue, shouldMaskField } from './masking.ts';
import type { ProbeElementDescriptor } from './replay.ts';
import {
  hopSelector,
  pickSelectorStrategy,
  stagehandMethodFor,
  toObserveResult
} from './replay.ts';
import { snapshotScript } from './snapshot.ts';
import { buildProbeSource } from './source.ts';

describe('@spyglass/probe', () => {
  it('exposes the reserved package name', () => {
    expect(probePackageName()).toBe(PROBE_PACKAGE);
  });

  it('masks password and card autocomplete, never both clear and secret', () => {
    expect(shouldMaskField({ type: 'password' })).toBe(true);
    expect(maskCapturedValue('hunter2', { type: 'password' })).toEqual({
      masked: true,
      secretRef: 'SECRET_PASSWORD'
    });
    expect(maskCapturedValue('4111111111111111', { autocomplete: 'cc-number' })).toEqual({
      masked: true,
      secretRef: 'SECRET_CARD'
    });
    expect(maskCapturedValue('demo', { type: 'text', name: 'user' })).toEqual({
      masked: false,
      text: 'demo'
    });
    expect(shouldMaskField({ autocomplete: 'current-password' })).toBe(true);
    expect(shouldMaskField({ autocomplete: 'new-password' })).toBe(true);
    expect(shouldMaskField({ autocomplete: 'one-time-code' })).toBe(true);
    expect(maskCapturedValue('123456', { autocomplete: 'one-time-code' })).toEqual({
      masked: true,
      secretRef: 'SECRET_PASSWORD'
    });
  });

  it('aggregates keystrokes until idle (F-16)', async () => {
    const flushed: string[] = [];
    const agg = new InputAggregator(30, (entry) => {
      flushed.push(entry.text);
    });
    agg.note({
      key: 'a',
      target: { framePath: ['main'], shadowPath: [] },
      text: 'h',
      field: {},
      ts: 1
    });
    agg.note({
      key: 'a',
      target: { framePath: ['main'], shadowPath: [] },
      text: 'hi',
      field: {},
      ts: 2
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(flushed).toEqual(['hi']);
  });

  it('drops click+change on the same control and honors scroll threshold', () => {
    const target = { framePath: ['main'], shadowPath: [], id: 'agree' };
    expect(isRedundantClickBeforeChange('dom.click', 'dom.check', target, target, 10, 40)).toBe(
      true
    );
    expect(
      isLabelClickForControlChange(
        'dom.click',
        'dom.check',
        { framePath: ['main'], shadowPath: [], tag: 'label', htmlFor: 'agree' },
        { framePath: ['main'], shadowPath: [], id: 'agree' },
        10,
        40
      )
    ).toBe(true);
    expect(
      isLabelClickForControlChange(
        'dom.click',
        'dom.check',
        { framePath: ['main'], shadowPath: [], tag: 'label', htmlFor: 'other' },
        { framePath: ['main'], shadowPath: [], id: 'agree' },
        10,
        40
      )
    ).toBe(false);
    expect(
      isLabelClickForControlChange(
        'dom.click',
        'dom.check',
        { framePath: ['main'], shadowPath: [], tag: 'label' },
        { framePath: ['main'], shadowPath: [], id: 'agree' },
        10,
        40
      )
    ).toBe(false);
    expect(shouldCaptureScroll(199, 200)).toBe(false);
    expect(shouldCaptureScroll(200, 200)).toBe(true);
  });

  it('builds ObserveResult-compatible hops for iframe and prefers testId', () => {
    const iframeTarget: ProbeElementDescriptor = {
      tag: 'button',
      framePath: ['main', 'iframe#lot1-frame'],
      shadowPath: [],
      testId: 'step-9',
      id: 'step-9'
    };
    const picked = pickSelectorStrategy(iframeTarget);
    expect(picked.selectorStrategy).toBe('testId');
    expect(hopSelector(iframeTarget.framePath, picked.selector)).toBe(
      'iframe#lot1-frame >> [data-testid="step-9"]'
    );
    expect(stagehandMethodFor('dom.check', 'check')).toBe('setChecked');
    expect(stagehandMethodFor('dom.dblclick', 'click')).toBe('doubleClick');
    const action = toObserveResult(
      {
        type: 'click',
        selector: 'iframe#lot1-frame >> [data-testid="step-9"]',
        description: 'Clic iframe'
      },
      'dom.click'
    );
    expect(action.method).toBe('click');
    expect(action.selector).toContain('>>');
  });

  it('does not use iframe hops for open-shadow hosts', () => {
    const shadowTarget: ProbeElementDescriptor = {
      tag: 'button',
      framePath: ['main'],
      shadowPath: ['#lot1-widget'],
      testId: 'step-10',
      id: 'step-10'
    };
    const picked = pickSelectorStrategy(shadowTarget);
    expect(hopSelector(shadowTarget.framePath, picked.selector)).toBe('[data-testid="step-10"]');
  });

  it('stringifies the injectable probe without a guessable global name', () => {
    const source = buildProbeSource({
      nonce: 'deadbeef',
      inputAggregationMs: INPUT_AGGREGATION_MS,
      scrollThresholdPx: 200,
      framePath: ['main']
    });
    expect(source).toContain('deadbeef');
    expect(source).not.toContain('window.spyglass');
    expect(source).toContain('addEventListener');
    expect(source).toContain('console.log');
    expect(source).toContain('SPYGLASS:');
    expect(source).not.toMatch(/\bPROBE_CONSOLE_PREFIX\b/);
    expect(source).not.toContain('__vite_ssr_import');
    expect(source).toContain('SECRET_PASSWORD');
    expect(source).toContain('htmlFor');
    expect(source).toContain('CSS.escape');
    expect(source).toContain('[id="');
    expect(source).toContain('Symbol.for');
    expect(source).toContain('spyglass.probe.v1');
    expect(source).toContain('spyglass.probe.flush');
    expect(source).toContain('flushAllPendingInputs');
    expect(source).toContain('takePendingInput');
    expect(source).toContain('flushInstalled');
    expect(source).toContain('return events');
    expect(source).not.toContain('flush hook is best-effort');
    const flushHookAt = source.indexOf('spyglass.probe.flush');
    const clickListenerAt = source.search(/addEventListener\(['"]click['"]/);
    expect(flushHookAt).toBeGreaterThan(-1);
    expect(clickListenerAt).toBeGreaterThan(flushHookAt);
    expect(source.indexOf('flushInstalled')).toBeGreaterThan(-1);
    expect(source.indexOf('flushInstalled')).toBeLessThan(clickListenerAt);
    expect(source).not.toContain('__sgInstalled');
    expect(source).not.toContain('__sdeadbeef');
    expect(source).not.toContain("addEventListener('wheel'");
    expect(source).toMatch(/el\.type !== ["']file["']/);
    expect(source).toContain('scrollAccumByTarget');
    expect(source).toContain('isFileField');
    expect(source).toContain('configurable: false');
    expect(source).not.toContain('still attach listeners');
  });

  it('escapes shadow host ids in the snapshot script', () => {
    const source = snapshotScript(['main']);
    expect(source).toContain('CSS.escape');
    expect(source).toContain('[data-testid="');
    expect(source).not.toMatch(/`#\$\{node\.id\}`/);
  });
});
