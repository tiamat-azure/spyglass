import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Reject HTML/error bodies when downloading the ~575 Mo large model. */
export const STT_LARGE_MIN_BYTES = 1_000_000;

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

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
