import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  downloadResponseToFileAtomic,
  streamToFileAtomic,
  writeFileAtomic
} from './download-model.ts';
import { notifyFirstUseLatency } from './whisper-engine.ts';

describe('Lot 7 STT download atomic publish (L7-005)', () => {
  it('writes via temp file then rename and verifies digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-dl-'));
    const dest = join(dir, 'model.bin');
    const payload = Buffer.from('large-v3-turbo-stub');
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const result = await streamToFileAtomic({
      dest,
      stream: Readable.from(payload),
      expectedBytes: payload.length,
      expectedSha256: sha256,
      minBytes: 1
    });
    expect(result.bytes).toBe(payload.length);
    expect(result.sha256).toBe(sha256);
    expect(await readFile(dest, 'utf8')).toBe('large-v3-turbo-stub');
  });

  it('rejects a digest mismatch and leaves dest unpublished', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-bad-'));
    const dest = join(dir, 'model.bin');
    await expect(
      streamToFileAtomic({
        dest,
        stream: Readable.from(Buffer.from('nope')),
        expectedSha256: '00'.repeat(32),
        minBytes: 1
      })
    ).rejects.toThrow(/digest mismatch/);
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writeFileAtomic publishes without buffering callers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-atomic-'));
    const dest = join(dir, 'stub.bin');
    await writeFileAtomic(dest, Buffer.from('ok\n'));
    expect(await readFile(dest, 'utf8')).toBe('ok\n');
  });

  it('rejects a non-2xx Response before streaming (L7-015)', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'spyglass-stt-http-')), 'model.bin');
    const html = '<html>error</html>';
    const response = new Response(html, {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-length': String(html.length) }
    });
    await expect(
      downloadResponseToFileAtomic({ dest, response, minBytes: 1 })
    ).rejects.toThrow(/HTTP 404/);
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('Lot 7 first-use latency isolation (L7-008)', () => {
  it('does not throw when the latency hook fails', async () => {
    await expect(
      notifyFirstUseLatency(async () => {
        throw new Error('disk full');
      }, 3500)
    ).resolves.toBeUndefined();
  });
});
