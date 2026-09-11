import type { SttEngine } from './engine.ts';
import { parseClientMessage, type ServerMessage, STT_SAMPLE_RATE } from './protocol.ts';
import { createEngineFromEnvAsync } from './resolve-engine.ts';
import { type LocalWsConnection, type LocalWsServer, listenLocalWs } from './ws-localhost.ts';

type Session = {
  utteranceId: string;
  startTs: number;
};

export type SidecarHandle = {
  port: number;
  engine: string;
  model: string;
  close: () => Promise<void>;
};

function send(connection: LocalWsConnection, message: ServerMessage): void {
  connection.sendText(JSON.stringify(message));
}

export async function startSidecarServer(
  env: NodeJS.ProcessEnv = process.env,
  provided?: SttEngine
): Promise<SidecarHandle> {
  const engine = provided ?? (await createEngineFromEnvAsync(env));
  const sessions = new Map<string, Session>();
  let current: Session | undefined;

  const server: LocalWsServer = await listenLocalWs({
    onConnection: (connection) => {
      send(connection, {
        type: 'ready',
        engine: engine.name,
        model: engine.model,
        network: false
      });
      return {
        onText: (text) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text) as unknown;
          } catch {
            send(connection, { type: 'error', message: 'invalid json' });
            return;
          }
          const message = parseClientMessage(parsed);
          if (message === undefined) {
            send(connection, { type: 'error', message: 'invalid client message' });
            return;
          }
          if (message.type === 'hello') {
            return;
          }
          if (message.type === 'abort') {
            for (const session of sessions.values()) {
              engine.abort(session.utteranceId);
            }
            sessions.clear();
            current = undefined;
            return;
          }
          if (message.type === 'start') {
            // Keep prior utterance PCM in the engine until its own `end`/`final`.
            // Do not abort or reuse a shared session into the next begin.
            current = { utteranceId: message.utteranceId, startTs: message.startTs };
            sessions.set(message.utteranceId, current);
            engine.begin(message.utteranceId);
            return;
          }
          if (message.type === 'end') {
            const currentEnd = sessions.get(message.utteranceId);
            sessions.delete(message.utteranceId);
            if (current?.utteranceId === message.utteranceId) {
              current = undefined;
            }
            if (currentEnd === undefined) {
              return;
            }
            void engine.finalize(currentEnd.utteranceId).then((finalText) => {
              send(connection, {
                type: 'final',
                utteranceId: currentEnd.utteranceId,
                text: finalText,
                startTs: currentEnd.startTs,
                endTs: message.endTs
              });
            });
          }
        },
        onBinary: (payload) => {
          if (current === undefined) {
            return;
          }
          const utteranceId = current.utteranceId;
          const startTs = current.startTs;
          engine.pushPcm(utteranceId, payload, (partial) => {
            send(connection, {
              type: 'partial',
              utteranceId,
              text: partial,
              startTs
            });
          });
        },
        onClose: () => {
          for (const open of sessions.values()) {
            engine.abort(open.utteranceId);
          }
          sessions.clear();
          current = undefined;
        }
      };
    }
  });

  return {
    port: server.port,
    engine: engine.name,
    model: engine.model,
    close: async () => {
      engine.dispose?.();
      await server.close();
    }
  };
}

export async function runSidecarMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const handle = await startSidecarServer(env);
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      port: handle.port,
      engine: handle.engine,
      model: handle.model,
      sampleRate: STT_SAMPLE_RATE,
      network: false
    })}\n`
  );
  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 400).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
