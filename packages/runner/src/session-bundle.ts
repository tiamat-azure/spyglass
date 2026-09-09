import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

export const SESSION_BUNDLE_MANIFEST = 'spyglass-session.json';

export type SessionBundleManifest = {
  schemaVersion: 1;
  kind: 'spyglass-session';
  sessionId: string;
  exportedAt: string;
};

export type SessionExportResult = {
  dest: string;
  sessionId: string;
  manifestPath: string;
};

export async function exportSessionFolder(
  sessionDir: string,
  destDir: string,
  now = new Date()
): Promise<SessionExportResult> {
  const meta = await readSessionMeta(sessionDir);
  const dest = resolve(destDir);
  await mkdir(dest, { recursive: true });
  await cp(sessionDir, dest, { recursive: true, dereference: false });
  const manifest: SessionBundleManifest = {
    schemaVersion: 1,
    kind: 'spyglass-session',
    sessionId: meta.sessionId,
    exportedAt: now.toISOString()
  };
  const manifestPath = join(dest, SESSION_BUNDLE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { dest, sessionId: meta.sessionId, manifestPath };
}

export async function importSessionFolder(
  bundleDir: string,
  sessionsRoot: string
): Promise<{ sessionDir: string; sessionId: string }> {
  const source = resolve(bundleDir);
  const meta = await readSessionMeta(source);
  const sessionId = meta.sessionId;
  if (!isSafeSessionId(sessionId)) {
    throw new Error('import refused: invalid sessionId');
  }
  const root = resolve(sessionsRoot);
  const dest = resolve(root, sessionId);
  if (!isInsideSessionsRoot(root, dest)) {
    throw new Error('import refused: invalid sessionId');
  }
  await mkdir(root, { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await cp(source, dest, { recursive: true, dereference: false });
  return { sessionDir: dest, sessionId };
}

export async function readSessionMeta(sessionDir: string): Promise<{ sessionId: string }> {
  const raw = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf8')) as {
    sessionId?: unknown;
  };
  if (typeof raw.sessionId !== 'string' || raw.sessionId.trim().length === 0) {
    throw new Error('session meta.json is missing sessionId');
  }
  return { sessionId: raw.sessionId };
}

function isSafeSessionId(sessionId: string): boolean {
  if (sessionId !== basename(sessionId)) {
    return false;
  }
  if (sessionId === '.' || sessionId === '..') {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(sessionId);
}

function isInsideSessionsRoot(sessionsRoot: string, dest: string): boolean {
  const rel = relative(sessionsRoot, dest);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}
