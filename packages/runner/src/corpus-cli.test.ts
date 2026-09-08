import { describe, expect, it, vi } from 'vitest';
import { runCorpusCli } from './corpus-cli.ts';

vi.mock('./http-fixture.ts', () => ({
  startFixtureServer: async () => {
    throw new Error('listen EADDRINUSE');
  }
}));

describe('corpus-cli error handling (L6-014)', () => {
  it('writes stderr and exits 1 when the local fixture cannot bind', async () => {
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await runCorpusCli([])).toBe(1);
      expect(chunks.join('')).toMatch(/EADDRINUSE/);
    } finally {
      process.stderr.write = write;
    }
  });
});
