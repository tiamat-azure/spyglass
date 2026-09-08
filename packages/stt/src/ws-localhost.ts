import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export type LocalSocketHandlers = {
  onText: (text: string) => void;
  onBinary: (payload: Buffer) => void;
  onClose: () => void;
};

export type LocalWsConnection = {
  sendText: (text: string) => void;
  sendBinary: (payload: Buffer) => void;
  close: () => void;
};

export type LocalWsServer = {
  port: number;
  close: () => Promise<void>;
};

function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}${GUID}`).digest('base64');
}

export function encodeWsFrame(opcode: number, payload: Uint8Array): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  return Buffer.concat([header, payload]);
}

export function decodeWsFrames(
  buffer: Uint8Array,
  onFrame: (opcode: number, payload: Buffer) => void
): Buffer {
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  while (offset + 2 <= view.length) {
    const first = view[offset];
    const second = view[offset + 1];
    if (first === undefined || second === undefined) {
      break;
    }
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLen = second & 0x7f;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (offset + 4 > view.length) {
        break;
      }
      payloadLen = view.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > view.length) {
        break;
      }
      payloadLen = view.readUInt32BE(offset + 6);
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    const total = headerLen + maskLen + payloadLen;
    if (offset + total > view.length) {
      break;
    }
    let payload: Buffer = Buffer.from(view.subarray(offset + headerLen + maskLen, offset + total));
    if (masked) {
      const mask = view.subarray(offset + headerLen, offset + headerLen + 4);
      const unmasked = Buffer.alloc(payload.length);
      for (let index = 0; index < payload.length; index += 1) {
        const maskByte = mask[index % 4] ?? 0;
        unmasked[index] = (payload[index] ?? 0) ^ maskByte;
      }
      payload = unmasked;
    }
    onFrame(opcode, payload);
    offset += total;
  }
  return Buffer.from(view.subarray(offset));
}

function attachSocket(socket: Socket, handlers: LocalSocketHandlers): LocalWsConnection {
  let pending: Uint8Array = Buffer.alloc(0);
  const send = (opcode: number, payload: Buffer): void => {
    if (socket.destroyed) {
      return;
    }
    socket.write(encodeWsFrame(opcode, payload));
  };
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    pending = decodeWsFrames(pending, (opcode, payload) => {
      if (opcode === 1) {
        handlers.onText(payload.toString('utf8'));
        return;
      }
      if (opcode === 2) {
        handlers.onBinary(payload);
        return;
      }
      if (opcode === 8) {
        handlers.onClose();
        socket.end();
        return;
      }
      if (opcode === 9) {
        send(10, payload);
      }
    });
  });
  socket.on('close', () => {
    handlers.onClose();
  });
  return {
    sendText: (text: string) => {
      send(1, Buffer.from(text, 'utf8'));
    },
    sendBinary: (payload: Buffer) => {
      send(2, payload);
    },
    close: () => {
      send(8, Buffer.alloc(0));
      socket.end();
    }
  };
}

export function listenLocalWs(options: {
  onConnection: (connection: LocalWsConnection) => LocalSocketHandlers;
  host?: string;
  port?: number;
}): Promise<LocalWsServer> {
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    const httpServer: Server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, _head: Buffer) => {
      const key = req.headers['sec-websocket-key'];
      if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
        socket.end();
        return;
      }
      const hostHeader = String(req.headers.host ?? '');
      if (!hostHeader.startsWith('127.0.0.1') && !hostHeader.startsWith('localhost')) {
        socket.end();
        return;
      }
      const accept = acceptKey(key);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      let handlers: LocalSocketHandlers | undefined;
      const connection = attachSocket(socket, {
        onText: (text) => handlers?.onText(text),
        onBinary: (payload) => handlers?.onBinary(payload),
        onClose: () => handlers?.onClose()
      });
      handlers = options.onConnection(connection);
    });
    httpServer.listen(options.port ?? 0, host, () => {
      const address = httpServer.address() as AddressInfo | null;
      if (address === null) {
        reject(new Error('STT sidecar failed to bind localhost'));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            httpServer.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          })
      });
    });
    httpServer.on('error', reject);
  });
}
