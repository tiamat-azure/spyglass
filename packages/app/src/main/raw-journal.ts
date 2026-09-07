import { open, readFile, writeFile } from 'node:fs/promises';
import type { RawEvent } from '@spyglass/contracts';

export class RawJournal {
  private truncatedIncompleteLine = false;

  constructor(readonly path: string) {}

  didTruncateIncompleteLine(): boolean {
    return this.truncatedIncompleteLine;
  }

  async recover(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        await writeFile(this.path, '', 'utf8');
        return;
      }
      throw error;
    }
    if (raw.length === 0 || raw.endsWith('\n')) {
      return;
    }
    const lastNl = raw.lastIndexOf('\n');
    const kept = lastNl === -1 ? '' : raw.slice(0, lastNl + 1);
    await writeFile(this.path, kept, 'utf8');
    this.truncatedIncompleteLine = true;
  }

  async append(event: RawEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    const handle = await open(this.path, 'a');
    try {
      await handle.writeFile(line, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export function parseJsonl(raw: string): unknown[] {
  const events: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    events.push(JSON.parse(line) as unknown);
  }
  return events;
}
