import type { SttEngineName } from './protocol.ts';

export type PartialHandler = (text: string) => void;

export type SttEngine = {
  name: SttEngineName;
  model: string;
  begin(utteranceId: string): void;
  pushPcm(utteranceId: string, pcm: Buffer, onPartial: PartialHandler): void;
  finalize(utteranceId: string): Promise<string>;
  abort(utteranceId: string): void;
  /** Kill in-flight workers (whisper-cli children), not only Map entries. */
  dispose?: () => void;
};
