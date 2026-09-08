import type { SttEngine } from './engine.ts';
import { createEngineFromEnv } from './resolve-engine.ts';

type LiveUtterance = {
  utteranceId: string;
  startTs: number;
};

export type InProcessFinal = {
  utteranceId: string;
  text: string;
  startTs: number;
  endTs: number;
};

export type InProcessStt = {
  engine: string;
  model: string;
  begin: (utteranceId: string, startTs: number) => void;
  pushPcm: (pcm: Buffer, onPartial: (text: string) => void) => void;
  end: (endTs: number) => Promise<InProcessFinal | undefined>;
  abort: () => void;
  dispose: () => void;
};

/**
 * Engine session used by Electron main when the sidecar runs in-process
 * (CI / e2e / missing binary). Transport is still main-owned; the renderer
 * never opens a socket (ADR-0005).
 */
export function createInProcessStt(
  env: NodeJS.ProcessEnv = process.env,
  engine: SttEngine = createEngineFromEnv(env)
): InProcessStt {
  let live: LiveUtterance | undefined;
  return {
    engine: engine.name,
    model: engine.model,
    begin(utteranceId: string, startTs: number): void {
      live = { utteranceId, startTs };
      engine.begin(utteranceId);
    },
    pushPcm(pcm: Buffer, onPartial: (text: string) => void): void {
      if (live === undefined) {
        return;
      }
      engine.pushPcm(live.utteranceId, pcm, onPartial);
    },
    async end(endTs: number): Promise<InProcessFinal | undefined> {
      const current = live;
      live = undefined;
      if (current === undefined) {
        return undefined;
      }
      const text = await engine.finalize(current.utteranceId);
      return {
        utteranceId: current.utteranceId,
        text,
        startTs: current.startTs,
        endTs
      };
    },
    abort(): void {
      if (live !== undefined) {
        engine.abort(live.utteranceId);
        live = undefined;
      }
    },
    dispose(): void {
      if (live !== undefined) {
        engine.abort(live.utteranceId);
        live = undefined;
      }
      engine.dispose?.();
    }
  };
}
