import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

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
  const source = resolve(sessionDir);
  const dest = resolve(destDir);
  await assertNoCopyOverlap(source, dest);
  const parent = dirname(dest);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, '.spyglass-export-'));
  try {
    await cp(source, staging, { recursive: true, dereference: false });
    const manifest: SessionBundleManifest = {
      schemaVersion: 1,
      kind: 'spyglass-session',
      sessionId: meta.sessionId,
      exportedAt: now.toISOString()
    };
    const manifestPath = join(staging, SESSION_BUNDLE_MANIFEST);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await replaceDirectory(dest, staging);
    return { dest, sessionId: meta.sessionId, manifestPath: join(dest, SESSION_BUNDLE_MANIFEST) };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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
  await assertNoCopyOverlap(source, dest);
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, '.spyglass-import-'));
  try {
    await cp(source, staging, { recursive: true, dereference: false });
    await replaceDirectory(dest, staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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

/**
 * L7-013: never `rm(dest)` when dest is the source (or either contains the other).
 */
async function assertNoCopyOverlap(source: string, dest: string): Promise<void> {
  const sourceReal = await realpathExisting(source);
  const destReal = await realpathExisting(dest);
  if (sourceReal === destReal) {
    throw new Error('session copy refused: destination must not be the source session');
  }
  const destInsideSource = isInsideSessionsRoot(sourceReal, destReal);
  const sourceInsideDest = isInsideSessionsRoot(destReal, sourceReal);
  if (destInsideSource || sourceInsideDest) {
    throw new Error('session copy refused: destination must not overlap the source session');
  }
}

async function realpathExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch {
      return resolve(path);
    }
  }
}

/** L7-030: move dest aside, then publish staging; restore dest if publish fails. */
async function replaceDirectory(dest: string, staging: string): Promise<void> {
  const backup = `${dest}.spyglass-prev`;
  let backedUp = false;
  try {
    await rm(backup, { recursive: true, force: true });
    try {
      await rename(dest, backup);
      backedUp = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw err;
      }
    }
    await rename(staging, dest);
    if (backedUp) {
      await rm(backup, { recursive: true, force: true });
    }
  } catch (error) {
    if (backedUp) {
      await rm(dest, { recursive: true, force: true }).catch(() => undefined);
      await rename(backup, dest).catch(() => undefined);
    }
    throw error;
  }
}
