import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Reject HTML/error bodies when downloading the ~575 Mo large model. */
export const STT_LARGE_MIN_BYTES = 1_000_000;
/** Bound hung Hugging Face fetches so upgrade IPC cannot stall forever (L7-018). */
export const STT_LARGE_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export type StreamToFileAtomicInput = {
  dest: string;
  stream: NodeJS.ReadableStream;
  expectedBytes?: number;
  expectedSha256?: string;
  minBytes?: number;
};

/**
 * Stream to `dest.partial`, validate size/digest, then atomic rename (L7-005).
 */
export async function streamToFileAtomic(input: StreamToFileAtomicInput): Promise<{
  bytes: number;
  sha256: string;
}> {
  await mkdir(dirname(input.dest), { recursive: true });
  const partial = `${input.dest}.partial`;
  await rm(partial, { force: true });
  const hash = createHash('sha256');
  let bytes = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(input.stream, hasher, createWriteStream(partial));
    const sha256 = hash.digest('hex');
    const minBytes = input.minBytes ?? 0;
    if (minBytes > 0 && bytes < minBytes) {
      throw new Error(`downloaded file too small (${String(bytes)} < ${String(minBytes)} bytes)`);
    }
    if (input.expectedBytes !== undefined && bytes !== input.expectedBytes) {
      throw new Error(
        `downloaded size ${String(bytes)} !== Content-Length ${String(input.expectedBytes)}`
      );
    }
    if (
      input.expectedSha256 !== undefined &&
      input.expectedSha256.length > 0 &&
      sha256 !== input.expectedSha256.toLowerCase()
    ) {
      throw new Error('downloaded file digest mismatch');
    }
    await rename(partial, input.dest);
    return { bytes, sha256 };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeFileAtomic(dest: string, contents: Uint8Array): Promise<void> {
  await streamToFileAtomic({ dest, stream: Readable.from(Buffer.from(contents)), minBytes: 0 });
}

export async function downloadResponseToFileAtomic(input: {
  dest: string;
  response: Response;
  expectedSha256?: string;
  minBytes?: number;
}): Promise<{ bytes: number; sha256: string }> {
  if (!input.response.ok) {
    throw new Error(
      `download failed: HTTP ${String(input.response.status)} ${input.response.statusText}`.trim()
    );
  }
  if (input.response.body === null) {
    throw new Error('empty download body');
  }
  const lengthRaw = input.response.headers.get('content-length');
  let expectedBytes: number | undefined;
  if (lengthRaw !== null && lengthRaw.trim().length > 0) {
    const parsed = Number.parseInt(lengthRaw, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      expectedBytes = parsed;
    }
  }
  const stream = Readable.fromWeb(input.response.body as import('stream/web').ReadableStream);
  const opts: StreamToFileAtomicInput = {
    dest: input.dest,
    stream,
    minBytes: input.minBytes ?? STT_LARGE_MIN_BYTES
  };
  if (expectedBytes !== undefined) {
    opts.expectedBytes = expectedBytes;
  }
  if (input.expectedSha256 !== undefined && input.expectedSha256.length > 0) {
    opts.expectedSha256 = input.expectedSha256;
  }
  return await streamToFileAtomic(opts);
}

export function sttLargeDownloadTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STT_LARGE_DOWNLOAD_TIMEOUT_MS;
  if (raw === undefined || raw.trim().length === 0) {
    return STT_LARGE_DOWNLOAD_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : STT_LARGE_DOWNLOAD_TIMEOUT_MS;
}

export async function downloadUrlToFileAtomic(input: {
  dest: string;
  url: string;
  timeoutMs?: number;
  expectedSha256?: string;
  minBytes?: number;
}): Promise<{ bytes: number; sha256: string }> {
  const timeoutMs = input.timeoutMs ?? STT_LARGE_DOWNLOAD_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(input.url, { redirect: 'follow', signal });
  const opts: Parameters<typeof downloadResponseToFileAtomic>[0] = {
    dest: input.dest,
    response
  };
  if (input.minBytes !== undefined) {
    opts.minBytes = input.minBytes;
  }
  if (input.expectedSha256 !== undefined && input.expectedSha256.length > 0) {
    opts.expectedSha256 = input.expectedSha256;
  }
  return await downloadResponseToFileAtomic(opts);
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
