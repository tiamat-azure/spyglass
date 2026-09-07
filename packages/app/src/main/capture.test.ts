import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRawEvent } from '@spyglass/contracts';
import { toObserveResult } from '@spyglass/probe';
import { describe, expect, it } from 'vitest';
import { buildRawEvent, redactNetRequestUrl } from './capture-pipeline.ts';
import { iframeNameSelector } from './probe-host.ts';
import { parseJsonl, RawJournal } from './raw-journal.ts';
import { CaptureRetention } from './retention.ts';
import { formatEventId, newSessionId } from './session-ids.ts';
import {
  SessionOrchestrator,
  screenshotLimitFromEnv,
  sessionsDirFromEnv
} from './session-orchestrator.ts';
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
  it('keeps the last N screenshots and capture-time pinned failures', async () => {
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
    expect(event.action?.arguments).toEqual(['true']);
    expect(toObserveResult(event.action, 'dom.check').method).toBe('setChecked');
    expect(event.value).toEqual({ masked: false, text: 'true' });
    expect(JSON.stringify(event)).not.toContain('"on"');
    expect(validateRawEvent(event).valid).toBe(true);
  });

  it('encodes unchecked state as setChecked false, not a click toggle', () => {
    const event = buildRawEvent({
      id: 'evt_000015',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.check',
        ts: 15,
        checked: false,
        type: 'checkbox',
        target: {
          tag: 'input',
          framePath: ['main'],
          shadowPath: [],
          testId: 'step-5'
        }
      },
      stepIndex: 15
    });
    expect(event.action?.type).toBe('check');
    expect(event.action?.arguments).toEqual(['false']);
    expect(toObserveResult(event.action, 'dom.check').arguments).toEqual(['false']);
    expect(event.value).toEqual({ masked: false, text: 'false' });
    expect(validateRawEvent(event).valid).toBe(true);
  });

  it('strips in-memory htmlFor from journaled targets', () => {
    const event = buildRawEvent({
      id: 'evt_000014',
      sessionId: 'ses_test',
      wire: {
        kind: 'dom.click',
        ts: 14,
        target: {
          tag: 'label',
          framePath: ['main'],
          shadowPath: [],
          htmlFor: 'agree',
          testId: 'agree-label'
        }
      },
      stepIndex: 14
    });
    expect(event.target).not.toHaveProperty('htmlFor');
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

describe('session stop after record.stop append', () => {
  function stubPane() {
    return {
      snapshot: () => ({
        url: 'https://example.test/',
        title: 'fixture',
        loading: false,
        canGoBack: false,
        canGoForward: false
      })
    } as never;
  }

  type MetaSealer = {
    writeSealMeta: (eventCount: number, sealedAt: string) => Promise<void>;
  };

  it('rebuilds a full meta.json when the existing file is corrupt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-corrupt-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    const { sessionId } = await orch.start('https://example.test/start');
    await writeFile(join(root, sessionId, 'meta.json'), '{not-json', 'utf8');
    const result = await orch.stop();
    expect(orch.snapshot().state).toBe('sealed');
    expect(result.eventCount).toBeGreaterThanOrEqual(2);
    const meta = JSON.parse(await readFile(join(root, sessionId, 'meta.json'), 'utf8')) as {
      sessionId: string;
      startUrl: string;
      eventCount: number;
      sealedAt?: string;
    };
    expect(meta.sessionId).toBe(sessionId);
    expect(meta.startUrl).toBe('https://example.test/start');
    expect(meta.eventCount).toBe(result.eventCount);
    expect(typeof meta.sealedAt).toBe('string');
  });

  it('rebuilds meta.json when the file is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-missing-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    const { sessionId } = await orch.start('https://example.test/');
    await unlink(join(root, sessionId, 'meta.json'));
    const result = await orch.stop();
    expect(orch.snapshot().state).toBe('sealed');
    const meta = JSON.parse(await readFile(join(root, sessionId, 'meta.json'), 'utf8')) as {
      eventCount: number;
      sealedAt?: string;
    };
    expect(meta.eventCount).toBe(result.eventCount);
    expect(typeof meta.sealedAt).toBe('string');
  });

  it('retries {eventCount, sealedAt} and succeeds when meta recovers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-retry-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    await orch.start('https://example.test/');
    const sealer = orch as unknown as MetaSealer;
    const original = sealer.writeSealMeta.bind(orch);
    let calls = 0;
    sealer.writeSealMeta = async (eventCount, sealedAt) => {
      calls += 1;
      expect(eventCount).toEqual(expect.any(Number));
      expect(typeof sealedAt).toBe('string');
      if (calls === 1) {
        throw new Error('simulated meta write failure');
      }
      await original(eventCount, sealedAt);
    };
    const result = await orch.stop();
    expect(orch.snapshot().state).toBe('sealed');
    expect(result.eventCount).toBeGreaterThanOrEqual(2);
    expect(calls).toBeGreaterThanOrEqual(2);
    const meta = JSON.parse(await readFile(join(root, result.sessionId, 'meta.json'), 'utf8')) as {
      eventCount: number;
      sealedAt?: string;
    };
    expect(meta.eventCount).toBe(result.eventCount);
    expect(typeof meta.sealedAt).toBe('string');
    const events = parseJsonl(await readFile(join(root, result.sessionId, 'raw.jsonl'), 'utf8'));
    expect(events.some((event) => (event as { kind: string }).kind === 'record.stop')).toBe(true);
  });

  it('enters sealed-failed after a durable stop when meta stays unwritable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-unwritable-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    const { sessionId } = await orch.start('https://example.test/');
    const sealer = orch as unknown as MetaSealer;
    sealer.writeSealMeta = async () => {
      throw new Error('meta permanently unwritable');
    };
    await expect(orch.stop()).rejects.toThrow(/meta\.json could not be sealed/i);
    expect(orch.snapshot().state).toBe('sealed-failed');
    await expect(orch.stop()).rejects.toThrow(/Retry Stop to repair meta/i);
    expect(orch.snapshot().state).toBe('sealed-failed');
    await expect(orch.start('https://example.test/')).rejects.toThrow(/sealed-failed/);
    const events = parseJsonl(await readFile(join(root, sessionId, 'raw.jsonl'), 'utf8'));
    expect(
      events.filter((event) => (event as { kind: string }).kind === 'record.stop')
    ).toHaveLength(1);
    await orch.recordNav('nav.load');
    const afterNav = parseJsonl(await readFile(join(root, sessionId, 'raw.jsonl'), 'utf8'));
    expect(afterNav).toHaveLength(events.length);
  });

  it('retry Stop from sealed-failed repairs meta without a second record.stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-repair-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    const { sessionId } = await orch.start('https://example.test/');
    const sealer = orch as unknown as MetaSealer;
    const original = sealer.writeSealMeta.bind(orch);
    sealer.writeSealMeta = async () => {
      throw new Error('meta permanently unwritable');
    };
    await expect(orch.stop()).rejects.toThrow(/Retry Stop to repair meta/i);
    expect(orch.snapshot().state).toBe('sealed-failed');
    sealer.writeSealMeta = original;
    const result = await orch.stop();
    expect(orch.snapshot().state).toBe('sealed');
    expect(result.eventCount).toBeGreaterThanOrEqual(2);
    const events = parseJsonl(await readFile(join(root, sessionId, 'raw.jsonl'), 'utf8'));
    expect(
      events.filter((event) => (event as { kind: string }).kind === 'record.stop')
    ).toHaveLength(1);
    const meta = JSON.parse(await readFile(join(root, sessionId, 'meta.json'), 'utf8')) as {
      eventCount: number;
      sealedAt?: string;
    };
    expect(meta.eventCount).toBe(result.eventCount);
    expect(typeof meta.sealedAt).toBe('string');
  });

  it('appends drained last fills before record.stop while still recording', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-drain-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    const { sessionId } = await orch.start('https://example.test/');
    (orch as unknown as { probe: { drainPendingInputs: () => Promise<unknown[]> } }).probe = {
      drainPendingInputs: async () => [
        {
          v: 1,
          kind: 'dom.input',
          ts: Date.now(),
          page: { url: 'https://example.test/', title: 'fixture' },
          target: {
            tag: 'input',
            framePath: ['main'],
            shadowPath: [],
            id: 'name'
          },
          valueText: 'last fill'
        }
      ]
    };
    const result = await orch.stop();
    expect(orch.snapshot().state).toBe('sealed');
    const events = parseJsonl(await readFile(join(root, sessionId, 'raw.jsonl'), 'utf8'));
    const kinds = events.map((event) => (event as { kind: string }).kind);
    expect(kinds).toContain('dom.input');
    expect(kinds.indexOf('dom.input')).toBeLessThan(kinds.indexOf('record.stop'));
    expect(result.eventCount).toBe(events.length);
  });

  it('fails Stop without sealing when the probe flush hook cannot drain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spyglass-stop-flush-missing-'));
    const orch = new SessionOrchestrator(() => root, stubPane, {
      onEvent: () => {},
      onState: () => {}
    });
    const { sessionId } = await orch.start('https://example.test/');
    (orch as unknown as { probe: { drainPendingInputs: () => Promise<unknown[]> } }).probe = {
      drainPendingInputs: async () => {
        throw new Error('Cannot stop: probe flush hook missing');
      }
    };
    await expect(orch.stop()).rejects.toThrow(/probe flush hook missing/);
    expect(orch.snapshot().state).toBe('recording');
    const events = parseJsonl(await readFile(join(root, sessionId, 'raw.jsonl'), 'utf8'));
    expect(events.some((event) => (event as { kind: string }).kind === 'record.stop')).toBe(false);
  });
});

describe('iframe name selector', () => {
  it('never treats WebFrameMain.name as an element id', () => {
    expect(iframeNameSelector('lot1-frame')).toBe('iframe[name="lot1-frame"]');
    expect(iframeNameSelector('lot1-frame')).not.toContain('#');
    expect(iframeNameSelector('a"b')).toBe('iframe[name="a\\"b"]');
  });
});

describe('net request URL redaction', () => {
  it('keeps origin and path, drops query, hash, and userinfo', () => {
    expect(redactNetRequestUrl('https://api.example.test/v1/me?access_token=sekrit#frag')).toBe(
      'https://api.example.test/v1/me'
    );
    expect(redactNetRequestUrl('https://user:pass@api.example.test/v1/me')).toBe(
      'https://api.example.test/v1/me'
    );
    expect(redactNetRequestUrl('not a url?token=abc#x')).toBe('not a url');
  });
});
