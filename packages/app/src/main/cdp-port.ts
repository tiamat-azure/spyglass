import { createServer } from 'node:net';
import { app } from 'electron';

export async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate a CDP port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error !== undefined && error !== null) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function resolveCdpPort(): Promise<number> {
  const fromEnv = process.env.SPYGLASS_CDP_PORT;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return await findFreePort();
}

export function enableRemoteDebugging(port: number): void {
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

export function cdpHttpUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}
