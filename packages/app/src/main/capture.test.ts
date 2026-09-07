import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRawEvent } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { buildRawEvent } from './capture-pipeline.ts';
import { parseJsonl, RawJournal } from './raw-journal.ts';
import { CaptureRetention } from './retention.ts';
import { formatEventId, newSessionId } from './session-ids.ts';
import { screenshotLimitFromEnv, sessionsDirFromEnv } from './session-orchestrator.ts';
import { parseActStdout } from './stagehand-act.ts';

describe('session ids', () => {
  it('matches contract prefixes', () => {
    expect(newSessionId(new Date('2026-09-08T12:00:00.000Z'))).toMatch(/^ses_20260908/);
    expect(formatEventId(1)).toBe('evt_000001');
    expect(formatEventId(12)).toBe('evt_000012');
  });
});

describe('raw journal', () => {
  it('appends complete JSON lines and truncates a partial last line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-jsonl-'));
    const path = join(dir, 'raw.jsonl');
    const journal = new RawJournal(path);
    await journal.recover();
    await journal.append({
      schemaVersion: 1,
      id: 'evt_000001',
      sessionId: 'ses_test',
      ts: 1,
      kind: 'record.start'
    });
    await writeFile(path, `${await readFile(path, 'utf8')}{"id":"partial`, 'utf8');
    const recovered = new RawJournal(path);
    await recovered.recover();
    expect(recovered.didTruncateIncompleteLine()).toBe(true);
    const events = parseJsonl(await readFile(path, 'utf8'));
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe('evt_000001');
  });

  it('skips corrupt JSONL lines when counting', () => {
    const events = parseJsonl(
      '{"schemaVersion":1,"id":"evt_000001","sessionId":"ses_test","ts":1,"kind":"record.start"}\n{not-json\n{"schemaVersion":1,"id":"evt_000002","sessionId":"ses_test","ts":2,"kind":"record.stop"}\n'
    );
    expect(events).toHaveLength(2);
    expect((events[1] as { id: string }).id).toBe('evt_000002');
  });
});

describe('retention', () => {
  it('keeps the last N screenshots and pins failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-ret-'));
    const retention = new CaptureRetention(dir, { screenshotLimit: 3 });
    await retention.init();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    for (let step = 1; step <= 6; step += 1) {
      if (step === 2) {
        retention.pinFailure(2);
      }
      await retention.writeScreenshot(step, jpeg);
    }
    const files = await retention.listScreenshotFiles();
    expect(files).toContain('shot_000002.jpg');
    expect(files).toContain('shot_000006.jpg');
    expect(files).not.toContain('shot_000001.jpg');
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
});

describe('capture pipeline', () => {
  it('masks password fills and builds an ObserveResult hop selector', () => {
    const event = buildRawEvent({
      id: 'evt_000003',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.input',
        ts: 3,
        valueText: 'hunter2',
        type: 'password',
        name: 'password',
        target: {
          tag: 'input',
          framePath: ['main'],
          shadowPath: [],
          testId: 'step-3',
          name: 'password'
        }
      },
      stepIndex: 3
    });
    expect(event.value).toEqual({ masked: true, secretRef: 'SECRET_PASSWORD' });
    expect(event.action?.arguments).toEqual(['SECRET_PASSWORD']);
    expect(event.action?.selector).toBe('[data-testid="step-3"]');
    expect(validateRawEvent(event).valid).toBe(true);
  });

  it('uses iframe hops for local act() selectors', () => {
    const event = buildRawEvent({
      id: 'evt_000009',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.click',
        ts: 9,
        target: {
          tag: 'button',
          framePath: ['main', 'iframe#lot1-frame'],
          shadowPath: [],
          testId: 'step-9'
        }
      },
      stepIndex: 9
    });
    expect(event.action?.selector).toBe('iframe#lot1-frame >> [data-testid="step-9"]');
    expect(validateRawEvent(event).valid).toBe(true);
  });

  it('keeps open-shadow selectors in-frame so Stagehand CSS pierce can find them', () => {
    const event = buildRawEvent({
      id: 'evt_000010',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.click',
        ts: 10,
        target: {
          tag: 'button',
          framePath: ['main'],
          shadowPath: ['#lot1-widget'],
          testId: 'step-10',
          id: 'step-10'
        }
      },
      stepIndex: 10
    });
    expect(event.action?.selector).toBe('[data-testid="step-10"]');
    expect(event.action?.selector).not.toContain('>>');
    expect(event.action?.shadowPath).toEqual(['#lot1-widget']);
    expect(validateRawEvent(event).valid).toBe(true);
  });

  it('does not pass checkbox values as Stagehand click mouse buttons', () => {
    const event = buildRawEvent({
      id: 'evt_000005',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.check',
        ts: 5,
        valueText: 'on',
        checked: true,
        type: 'checkbox',
        target: {
          tag: 'input',
          framePath: ['main'],
          shadowPath: [],
          testId: 'step-5'
        }
      },
      stepIndex: 5
    });
    expect(event.action?.type).toBe('check');
    expect(event.action?.arguments).toBeUndefined();
    expect(event.value).toEqual({ masked: false, text: 'on' });
    expect(validateRawEvent(event).valid).toBe(true);
  });

  it('honors probe-side redaction without cleartext valueText', () => {
    const event = buildRawEvent({
      id: 'evt_000013',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.input',
        ts: 13,
        masked: true,
        secretRef: 'SECRET_PASSWORD',
        type: 'password',
        target: {
          tag: 'input',
          framePath: ['main'],
          shadowPath: [],
          testId: 'step-3'
        }
      },
      stepIndex: 13
    });
    expect(event.value).toEqual({ masked: true, secretRef: 'SECRET_PASSWORD' });
    expect(JSON.stringify(event)).not.toContain('hunter2');
    expect(validateRawEvent(event).valid).toBe(true);
  });
});

describe('parseActStdout', () => {
  it('reads llmCalls and per-action success', () => {
    const parsed = parseActStdout(
      'noise\n{"ok":true,"llmCalls":0,"results":[{"selector":"#a","method":"click","success":true,"message":"ok"}]}\n'
    );
    expect(parsed?.ok).toBe(true);
    expect(parsed?.llmCalls).toBe(0);
    expect(parsed?.results).toHaveLength(1);
  });
});

describe('session env', () => {
  it('defaults screenshot retention to 10 and sessions under userData', () => {
    expect(screenshotLimitFromEnv({})).toBe(10);
    expect(screenshotLimitFromEnv({ SCREENSHOT_RETENTION: '4' })).toBe(4);
    expect(sessionsDirFromEnv('/tmp/ud', {})).toBe('/tmp/ud/sessions');
    expect(sessionsDirFromEnv('/tmp/ud', { SESSIONS_DIR: '/tmp/sessions' })).toBe('/tmp/sessions');
  });
});
