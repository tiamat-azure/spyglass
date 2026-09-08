import type { SttEngine } from './engine.ts';
import { parseClientMessage, type ServerMessage, STT_SAMPLE_RATE } from './protocol.ts';
import { createEngineFromEnv } from './resolve-engine.ts';
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
  engine: SttEngine = createEngineFromEnv(env)
): Promise<SidecarHandle> {
  let session: Session | undefined;

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
            if (session !== undefined) {
              engine.abort(session.utteranceId);
              session = undefined;
            }
            return;
          }
          if (message.type === 'start') {
            if (session !== undefined) {
              engine.abort(session.utteranceId);
            }
            session = { utteranceId: message.utteranceId, startTs: message.startTs };
            engine.begin(message.utteranceId);
            return;
          }
          if (message.type === 'end') {
            const current = session;
            session = undefined;
            if (current === undefined) {
              return;
            }
            void engine.finalize(current.utteranceId).then((finalText) => {
              send(connection, {
                type: 'final',
                utteranceId: current.utteranceId,
                text: finalText,
                startTs: current.startTs,
                endTs: message.endTs
              });
            });
          }
        },
        onBinary: (payload) => {
          if (session === undefined) {
            return;
          }
          const utteranceId = session.utteranceId;
          const startTs = session.startTs;
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
          if (session !== undefined) {
            engine.abort(session.utteranceId);
            session = undefined;
          }
        }
      };
    }
  });

  return {
    port: server.port,
    engine: engine.name,
    model: engine.model,
    close: server.close
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
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
