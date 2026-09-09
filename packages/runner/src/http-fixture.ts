import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_CORPUS_SIZE } from './corpus.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const RUNNER_FIXTURES_DIR = join(here, '../fixtures');

export type FixtureServer = {
  origin: string;
  port: number;
  close: () => Promise<void>;
};

export async function startFixtureServer(host = '127.0.0.1'): Promise<FixtureServer> {
  const lot6Html = await readFile(join(RUNNER_FIXTURES_DIR, 'lot6-fixture.html'), 'utf8');
  const server = createServer((request, response) => {
    void handle(request, response, lot6Html).catch(() => {
      if (response.writableEnded) {
        return;
      }
      if (!response.headersSent) {
        send(response, 500, 'text/plain; charset=utf-8', 'internal error');
        return;
      }
      response.end();
    });
  });
  await listen(server, host);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server has no address');
  }
  const origin = `http://${host}:${String(address.port)}`;
  return {
    origin,
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  lot6Html: string
): Promise<void> {
  const rawUrl = request.url ?? '/';
  if (rawPathHasEncodedDots(rawUrl)) {
    send(response, 404, 'text/plain; charset=utf-8', 'not found');
    return;
  }
  const url = new URL(rawUrl, 'http://127.0.0.1');
  if (url.pathname === '/' || url.pathname === '/lot6-fixture.html') {
    send(response, 200, 'text/html; charset=utf-8', lot6Html);
    return;
  }
  const site = /^\/site-(\d{2})\/?$/u.exec(url.pathname);
  if (site?.[1] !== undefined) {
    const index = Number.parseInt(site[1], 10);
    if (index >= 1 && index <= LOCAL_CORPUS_SIZE) {
      send(response, 200, 'text/html; charset=utf-8', localSiteHtml(index));
      return;
    }
  }
  if (url.pathname === '/tree.html') {
    send(response, 200, 'text/html; charset=utf-8', '<pre id="tree"></pre>');
    return;
  }
  const ext = extname(url.pathname);
  if (ext === '.html') {
    const candidate = resolveFixtureHtmlPath(url.pathname);
    if (candidate !== undefined) {
      try {
        const body = await readFile(candidate, 'utf8');
        send(response, 200, 'text/html; charset=utf-8', body);
        return;
      } catch {
        // fall through
      }
    }
  }
  send(response, 404, 'text/plain; charset=utf-8', 'not found');
}

/** True when the raw path (not query) contains percent-encoded `.` / `..` (L6-054). */
export function rawPathHasEncodedDots(rawUrl: string): boolean {
  const cut = rawUrl.indexOf('?');
  const path = cut === -1 ? rawUrl : rawUrl.slice(0, cut);
  return /%2e/i.test(path);
}

/** Absolute path under the fixtures dir, or undefined for traversal / escape (L6-025). */
export function resolveFixtureHtmlPath(pathname: string): string | undefined {
  if (rawPathHasEncodedDots(pathname)) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return undefined;
  }
  const segments = decoded.split(/[/\\]/u).filter((part) => part.length > 0);
  if (segments.some((part) => part === '.' || part === '..')) {
    return undefined;
  }
  const fixturesRoot = resolve(RUNNER_FIXTURES_DIR);
  const candidate = resolve(fixturesRoot, ...segments);
  if (!isInsideResolvedDir(fixturesRoot, candidate)) {
    return undefined;
  }
  return candidate;
}

function isInsideResolvedDir(dir: string, targetPath: string): boolean {
  const rel = relative(dir, targetPath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function localSiteHtml(index: number): string {
  const id = String(index).padStart(2, '0');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Corpus site ${id}</title>
  </head>
  <body>
    <main>
      <h1 id="title" data-testid="title">Corpus site ${id}</h1>
      <p>Local protocol fixture. Marker: SPYGLASS_CORPUS_${id}</p>
    </main>
  </body>
</html>
`;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function listen(server: Server, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
