import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  downloadResponseToFileAtomic,
  downloadUrlToFileAtomic,
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
    await expect(downloadResponseToFileAtomic({ dest, response, minBytes: 1 })).rejects.toThrow(
      /HTTP 404/
    );
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels the response body before throwing on non-2xx (L7-057)', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'spyglass-stt-cancel-')), 'model.bin');
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        cancelled = true;
      }
    });
    const response = new Response(stream, { status: 503, statusText: 'Unavailable' });
    await expect(downloadResponseToFileAtomic({ dest, response, minBytes: 1 })).rejects.toThrow(
      /HTTP 503/
    );
    expect(cancelled).toBe(true);
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('publishes a small body when the caller passes an explicit low minBytes (L7-114)', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'spyglass-stt-tiny-')), 'model.bin');
    const payload = 'tiny-weights';
    const response = new Response(payload, { status: 200, statusText: 'OK' });
    const result = await downloadResponseToFileAtomic({ dest, response, minBytes: 1 });
    expect(result.bytes).toBe(payload.length);
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });

  it('does not default downloadResponseToFileAtomic minBytes to STT_LARGE_MIN_BYTES (L7-114)', async () => {
    const src = await readFile(new URL('./download-model.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function downloadResponseToFileAtomic');
    const end = src.indexOf('export function sttLargeDownloadTimeoutMs');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const helper = src.slice(start, end);
    expect(helper).not.toMatch(/minBytes \?\? STT_LARGE_MIN_BYTES/);
    expect(helper).toMatch(/minBytes: number/);
  });

  it('aborts a hung URL download (L7-018)', async () => {
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const dest = join(await mkdtemp(join(tmpdir(), 'spyglass-stt-hang-')), 'model.bin');
      await expect(
        downloadUrlToFileAtomic({
          dest,
          url: `http://127.0.0.1:${String(port)}/`,
          timeoutMs: 50,
          minBytes: 1
        })
      ).rejects.toMatchObject({ name: 'TimeoutError' });
      await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined ? reject(err) : resolve()));
      });
    }
  });
});

describe('W3a fetch-whisper --large', () => {
  it('routes --large through downloadResponseToFileAtomic, not download()', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const largeStart = src.indexOf('if (large)');
    const largeEnd = src.indexOf('const modelPath');
    expect(largeStart).toBeGreaterThan(-1);
    expect(largeEnd).toBeGreaterThan(largeStart);
    const largeBlock = src.slice(largeStart, largeEnd);
    expect(largeBlock).toMatch(/downloadResponseToFileAtomic/);
    expect(largeBlock).toMatch(/STT_LARGE_SHA256/);
    expect(largeBlock).toMatch(/minBytes:\s*STT_LARGE_MIN_BYTES/);
    expect(largeBlock).not.toMatch(/\bawait download\(/);
  });

  it('does not statically import TypeScript modules (L7-086)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const header = src.slice(0, src.indexOf('async function main'));
    expect(header).not.toMatch(/packages\/stt/);
    expect(src).toMatch(/await import\(\s*'\.\.\/packages\/stt\/src\/download-model\.ts'/);
  });
});

describe('Lot 7 first-use latency isolation (L7-008)', () => {
  it('does not throw when the latency hook fails', async () => {
    await expect(
      notifyFirstUseLatency(async () => {
        throw new Error('disk full');
      }, 3500)
    ).resolves.toBe(false);
    await expect(notifyFirstUseLatency(async () => undefined, 10)).resolves.toBe(true);
  });
});
