import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  downloadResponseToFileAtomic,
  downloadUrlToFileAtomic,
  existingVerifiedDownloadOk,
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

  it('does not publish dest when minBytes or expectedBytes fail (L7-283)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7283-'));
    const dest = join(dir, 'model.bin');
    await expect(
      streamToFileAtomic({
        dest,
        stream: Readable.from(Buffer.from('tiny')),
        minBytes: 1_000_000
      })
    ).rejects.toThrow(/too small/);
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(dest, 'keep-me');
    await expect(
      streamToFileAtomic({
        dest,
        stream: Readable.from(Buffer.from('truncated-huge-body')),
        expectedBytes: 99_999
      })
    ).rejects.toThrow(/Content-Length/);
    expect(await readFile(dest, 'utf8')).toBe('keep-me');

    const src = await readFile(new URL('./download-model.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function streamToFileAtomic');
    const end = src.indexOf('export async function writeFileAtomic');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    const renameIdx = body.indexOf('await rename(partial, input.dest)');
    expect(renameIdx).toBeGreaterThan(body.indexOf('onDisk < minBytes'));
    expect(renameIdx).toBeGreaterThan(body.indexOf('onDisk !== input.expectedBytes'));
  });

  it('skips only when dest is a regular file with minBytes and SHA-256 (L7-263)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spyglass-stt-l7263-'));
    const dest = join(dir, 'model.bin');
    const payload = Buffer.from('verified-large-stub');
    const sha256 = createHash('sha256').update(payload).digest('hex');
    expect(await existingVerifiedDownloadOk({ dest, minBytes: 1, expectedSha256: sha256 })).toBe(
      false
    );
    await writeFile(dest, payload);
    expect(
      await existingVerifiedDownloadOk({ dest, minBytes: payload.length, expectedSha256: sha256 })
    ).toBe(true);
    expect(
      await existingVerifiedDownloadOk({
        dest,
        minBytes: payload.length + 1,
        expectedSha256: sha256
      })
    ).toBe(false);
    expect(
      await existingVerifiedDownloadOk({
        dest,
        minBytes: 1,
        expectedSha256: '00'.repeat(32)
      })
    ).toBe(false);
    expect(await existingVerifiedDownloadOk({ dest, minBytes: 1, expectedSha256: '' })).toBe(false);
    const src = await readFile(new URL('./download-model.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function existingVerifiedDownloadOk');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    expect(body.indexOf('await pipeline(createReadStream(input.dest), hash)')).toBeGreaterThan(
      body.indexOf('try {')
    );
    expect(body.indexOf('await pipeline(createReadStream(input.dest), hash)')).toBeLessThan(
      body.indexOf('} catch {')
    );
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

  it('skips Content-Length vs written bytes when content-encoding is set (L7-196)', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'spyglass-stt-enc-')), 'model.bin');
    const payload = 'decoded-weights';
    const response = new Response(payload, {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-length': '9999',
        'content-encoding': 'gzip'
      }
    });
    const encoded = await downloadResponseToFileAtomic({ dest, response, minBytes: 1 });
    expect(encoded.bytes).toBe(payload.length);
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });

  it('still rejects Content-Length mismatch when content-encoding is absent', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'spyglass-stt-clen-')), 'model.bin');
    const response = new Response('short', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-length': '9999' }
    });
    await expect(downloadResponseToFileAtomic({ dest, response, minBytes: 1 })).rejects.toThrow(
      /Content-Length/
    );
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
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
    expect(largeBlock).toMatch(/if\s*\(!response\.ok\)/);
    expect(largeBlock).not.toMatch(/\bawait download\(/);
  });

  it('downloads default small via atomic min-size path (L7-237)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const start = src.indexOf('const modelPath');
    const end = src.indexOf('void main()');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('downloadResponseAtomic');
    expect(body).toContain('SMALL_MIN_BYTES');
    expect(body).toContain('existingSmallOk');
    expect(body).not.toMatch(/\bawait download\(/);
    expect(src).toContain('async function downloadResponseAtomic');
    expect(src).toMatch(/const SMALL_MIN_BYTES = 10_000_000/);
    expect(src).not.toMatch(/const SMALL_MIN_BYTES = 1_000_000/);
  });

  it('ensures ggml-small-q5_1.bin on --large before returning (W18a)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const largeStart = src.indexOf('if (large)');
    const largeEnd = src.indexOf('const modelPath');
    expect(largeStart).toBeGreaterThan(-1);
    expect(largeEnd).toBeGreaterThan(largeStart);
    const largeBlock = src.slice(largeStart, largeEnd);
    expect(largeBlock).toContain('await ensureSmallFallback(');
    expect(largeBlock.indexOf('await ensureSmallFallback(')).toBeLessThan(
      largeBlock.lastIndexOf('return')
    );
    const fnStart = src.indexOf('function existingSmallOk');
    const fnEnd = src.indexOf('async function main');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain('MODEL_NAME');
    expect(body).toContain('existingSmallOk');
    expect(body).toContain('statSync');
    expect(body).toContain('isFile()');
    expect(body).toContain('SMALL_MIN_BYTES');
    expect(body).toContain('downloadAtomic');
    expect(body).not.toMatch(/\bawait download\(/);
    expect(body).not.toContain('existsSync');
    expect(src).toMatch(/const MODEL_NAME = 'ggml-small-q5_1\.bin'/);
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

  it('ensures whisper-cli on --large before returning (C26a)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const largeStart = src.indexOf('if (large)');
    const largeEnd = src.indexOf('const modelPath');
    expect(largeStart).toBeGreaterThan(-1);
    expect(largeEnd).toBeGreaterThan(largeStart);
    const largeBlock = src.slice(largeStart, largeEnd);
    expect(largeBlock).toContain('await ensureWhisperCli()');
    expect(largeBlock.indexOf('await ensureWhisperCli()')).toBeLessThan(
      largeBlock.indexOf('await fetch(STT_LARGE_MODEL_URL')
    );
    expect(largeBlock.indexOf('await ensureWhisperCli()')).toBeLessThan(
      largeBlock.indexOf('await ensureSmallFallback(')
    );
    expect(largeBlock.indexOf('await ensureWhisperCli()')).toBeLessThan(
      largeBlock.lastIndexOf('return')
    );
    const fnStart = src.indexOf('async function ensureWhisperCli');
    const fnEnd = src.indexOf('const SMALL_MIN_BYTES');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain('existingCliOk');
    expect(body).toContain('cliAsset()');
    expect(body).toContain('await download(cli.url, archivePath)');
    expect(body).toContain('extractArchive');
    expect(body).toContain('findNamedFile');
    expect(src.slice(largeEnd)).toContain('await ensureWhisperCli()');
  });

  it('extracts zip archives without always tar -xf (W28b)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    expect(src).toContain("plat === 'win32'");
    expect(src).toContain(
      "url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip'"
    );
    expect(src).toContain('v1.9.2/whisper-bin-ubuntu-');
    expect(src).not.toContain('v1.7.5/whisper-bin-');
    const winStart = src.indexOf("if (plat === 'win32')");
    expect(winStart).toBeGreaterThan(-1);
    const winEnd = src.indexOf('return undefined;', winStart);
    expect(winEnd).toBeGreaterThan(winStart);
    const winBlock = src.slice(winStart, winEnd);
    expect(winBlock).toContain('.zip');
    expect(winBlock).not.toContain('.tar.gz');
    const extractStart = src.indexOf('function extractArchive');
    const extractEnd = src.indexOf('async function ensureWhisperCli');
    expect(extractStart).toBeGreaterThan(-1);
    expect(extractEnd).toBeGreaterThan(extractStart);
    const extract = src.slice(extractStart, extractEnd);
    expect(extract).toContain('/\\.zip$/i.test(archivePath)');
    expect(extract).toContain('extractZip');
    expect(extract).not.toMatch(
      /function extractArchive\([^)]*\) \{\s*const result = spawnSync\('tar'/
    );
    const zipStart = src.indexOf('function extractZip');
    expect(zipStart).toBeGreaterThan(-1);
    const zipFn = src.slice(zipStart, extractStart);
    expect(zipFn).toContain("process.platform === 'win32'");
    expect(zipFn).toContain('Expand-Archive');
    expect(zipFn).toContain('powershell.exe');
    expect(src).toContain("['-xf', archivePath, '-C', extractDir]");
  });

  it('skips Darwin CLI ensure instead of requiring Unix whisper-cli (D34a)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const assetStart = src.indexOf('function cliAsset()');
    const assetEnd = src.indexOf('async function download(');
    expect(assetStart).toBeGreaterThan(-1);
    expect(assetEnd).toBeGreaterThan(assetStart);
    const asset = src.slice(assetStart, assetEnd);
    const darwinStart = asset.indexOf("plat === 'darwin'");
    const winStart = asset.indexOf("plat === 'win32'");
    expect(darwinStart).toBeGreaterThan(-1);
    expect(winStart).toBeGreaterThan(darwinStart);
    const darwinBlock = asset.slice(darwinStart, winStart);
    expect(darwinBlock).toContain('return undefined');
    expect(darwinBlock).not.toContain("name: 'whisper-cli'");
    expect(src).not.toMatch(/'whisper-bin-x64\.zip:whisper-cli':/);
    const fnStart = src.indexOf('async function ensureWhisperCli');
    const fnEnd = src.indexOf('const SMALL_MIN_BYTES');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain("process.platform === 'darwin'");
    expect(body).toContain('Skipping CLI ensure');
    expect(body).not.toContain("name: 'whisper-cli'");
  });

  it('rejects extracted whisper-cli smaller than CLI_MIN_BYTES (L7-225)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const fnStart = src.indexOf('async function ensureWhisperCli');
    const fnEnd = src.indexOf('const SMALL_MIN_BYTES');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain('copyFileSync(found, dest)');
    expect(body.indexOf('copyFileSync(found, dest)')).toBeLessThan(
      body.lastIndexOf('existingCliOk(dest)')
    );
    expect(body.lastIndexOf('existingCliOk(dest)')).toBeLessThan(body.indexOf('chmodSync'));
    expect(body).toContain('CLI_MIN_BYTES');
  });

  it('verifies extracted whisper-cli sha256 before chmod (I30a)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    expect(src).toContain('STT_WHISPER_CLI_SHA256');
    expect(src).toContain("createHash('sha256')");
    expect(src).toMatch(/'whisper-bin-ubuntu-x64\.tar\.gz:whisper-cli':\s*'[0-9a-f]{64}'/);
    expect(src).toMatch(/'whisper-bin-ubuntu-arm64\.tar\.gz:whisper-cli':\s*'[0-9a-f]{64}'/);
    expect(src).not.toMatch(/'whisper-bin-x64\.zip:whisper-cli':/);
    expect(src).toMatch(/'whisper-bin-x64\.zip:whisper-cli\.exe':\s*'[0-9a-f]{64}'/);
    const helpersStart = src.indexOf('function expectedCliSha256');
    const fnStart = src.indexOf('async function ensureWhisperCli');
    const fnEnd = src.indexOf('const SMALL_MIN_BYTES');
    expect(helpersStart).toBeGreaterThan(-1);
    expect(fnStart).toBeGreaterThan(helpersStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const helpers = src.slice(helpersStart, fnEnd);
    expect(helpers).toContain('STT_WHISPER_CLI_SHA256');
    expect(helpers).toContain("createHash('sha256')");
    expect(helpers).toContain('whisper-cli digest mismatch');
    expect(helpers).toContain('await rm(dest, { recursive: true, force: true })');
    const body = src.slice(fnStart, fnEnd);
    expect(body.indexOf('copyFileSync(found, dest)')).toBeLessThan(
      body.lastIndexOf('existingCliOk(dest)')
    );
    expect(body.lastIndexOf('existingCliOk(dest)')).toBeLessThan(
      body.indexOf('await assertCliIntegrity(dest, cli)')
    );
    expect(body.indexOf('await assertCliIntegrity(dest, cli)')).toBeLessThan(
      body.indexOf('chmodSync')
    );
  });

  it('verifies sha256 before skipping an existing whisper-cli or large model (L7-244)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    expect(src).toContain('async function existingCliDigestOk');
    const cliStart = src.indexOf('async function ensureWhisperCli');
    const cliEnd = src.indexOf('const SMALL_MIN_BYTES');
    expect(cliStart).toBeGreaterThan(-1);
    expect(cliEnd).toBeGreaterThan(cliStart);
    const cliBody = src.slice(cliStart, cliEnd);
    expect(cliBody).toContain('existingCliDigestOk(dest, cli)');
    expect(cliBody).toContain('existingCliOk(dest)');
    const largeStart = src.indexOf('if (large)');
    const largeEnd = src.indexOf('const modelPath');
    const largeBlock = src.slice(largeStart, largeEnd);
    expect(largeBlock).toContain('fileSha256(largePath)');
    expect(largeBlock).toContain('STT_LARGE_SHA256');
  });

  it('skips --large re-download when a valid large file is present (L7-229)', async () => {
    const src = await readFile(
      new URL('../../../scripts/fetch-whisper.mjs', import.meta.url),
      'utf8'
    );
    const largeStart = src.indexOf('if (large)');
    const largeEnd = src.indexOf('const modelPath');
    expect(largeStart).toBeGreaterThan(-1);
    expect(largeEnd).toBeGreaterThan(largeStart);
    const largeBlock = src.slice(largeStart, largeEnd);
    expect(largeBlock).toContain('existingLargeOk(largePath, STT_LARGE_MIN_BYTES)');
    expect(largeBlock).toContain('downloadResponseToFileAtomic');
    expect(largeBlock.indexOf('existingLargeOk(largePath, STT_LARGE_MIN_BYTES)')).toBeLessThan(
      largeBlock.indexOf('await fetch(STT_LARGE_MODEL_URL')
    );
    expect(largeBlock).toContain('fileSha256(largePath)');
    expect(largeBlock).toContain('STT_LARGE_SHA256');
    const fnStart = src.indexOf('function existingLargeOk');
    const fnEnd = src.indexOf('async function ensureSmallFallback');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain('statSync');
    expect(body).toContain('isFile()');
    expect(body).toContain('minBytes');
    expect(body).not.toContain('existsSync');
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

  it('emits a one-shot warning on the final failed persist attempt (L7-199)', async () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await expect(
        notifyFirstUseLatency(async () => {
          throw new Error('disk full');
        }, 10)
      ).resolves.toBe(false);
      expect(warnings).toHaveLength(0);
      await expect(
        notifyFirstUseLatency(
          async () => {
            throw new Error('disk full');
          },
          10,
          true
        )
      ).resolves.toBe(false);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0])).toMatch(/first-use latency persist failed/);
    } finally {
      console.warn = original;
    }
  });
});
