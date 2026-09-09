import type { SttEngine } from './engine.ts';
import { createMockEngine } from './mock-engine.ts';
import { parseMockTranscripts } from './protocol.ts';
import { createEngineFromEnvAsync, resolveSttEngineName } from './resolve-engine.ts';

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

function wrapInProcessStt(engine: SttEngine): InProcessStt {
  let live: LiveUtterance | undefined;
  let pendingFinalizeId: string | undefined;
  const abort = (): void => {
    if (live !== undefined) {
      engine.abort(live.utteranceId);
      live = undefined;
      return;
    }
    if (pendingFinalizeId !== undefined) {
      engine.abort(pendingFinalizeId);
      pendingFinalizeId = undefined;
    }
  };
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
      pendingFinalizeId = current.utteranceId;
      try {
        const text = await engine.finalize(current.utteranceId);
        return {
          utteranceId: current.utteranceId,
          text,
          startTs: current.startTs,
          endTs
        };
      } finally {
        if (pendingFinalizeId === current.utteranceId) {
          pendingFinalizeId = undefined;
        }
      }
    },
    abort,
    dispose(): void {
      abort();
      engine.dispose?.();
    }
  };
}

/**
 * Engine session used by Electron main when the sidecar runs in-process
 * (CI / e2e / missing binary). Transport is still main-owned; the renderer
 * never opens a socket (ADR-0005).
 *
 * A5b: this factory is synchronous. Pass `provided` to wrap an existing
 * engine (including whisper). Without `provided`, only the mock engine is
 * constructed here — whisper requires {@link createInProcessSttFromEnv}.
 */
export function createInProcessStt(
  env: NodeJS.ProcessEnv = process.env,
  provided?: SttEngine
): InProcessStt {
  if (provided !== undefined) {
    return wrapInProcessStt(provided);
  }
  if (resolveSttEngineName(env) === 'whisper') {
    throw new Error(
      'createInProcessStt is synchronous and cannot load whisper; call createInProcessSttFromEnv'
    );
  }
  return wrapInProcessStt(
    createMockEngine(parseMockTranscripts(env.SPYGLASS_STT_MOCK_TRANSCRIPTS))
  );
}

/** Async companion that awaits `createEngineFromEnvAsync` then wraps via the sync factory. */
export async function createInProcessSttFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  provided?: SttEngine
): Promise<InProcessStt> {
  return createInProcessStt(env, provided ?? (await createEngineFromEnvAsync(env)));
}
