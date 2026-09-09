import { randomBytes } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises';
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

export type SessionExportOptions = {
  now?: Date;
  overwrite?: boolean;
};

export async function exportSessionFolder(
  sessionDir: string,
  destDir: string,
  options: SessionExportOptions = {}
): Promise<SessionExportResult> {
  const now = options.now ?? new Date();
  const overwrite = options.overwrite === true;
  const meta = await readSessionMeta(sessionDir);
  const source = resolve(sessionDir);
  const dest = resolve(destDir);
  await assertNoCopyOverlap(source, dest);
  await recoverOrphanedBackup(dest);
  if (!overwrite) {
    await assertExportDestAvailable(dest);
  }
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
    // L7-154: a source symlink named spyglass-session.json would otherwise redirect this write.
    await unlinkIfPresent(manifestPath);
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
  await assertNoSymlinks(source);
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
  await recoverOrphanedBackup(dest);
  if (await pathExists(dest)) {
    throw new Error('import refused: session already exists');
  }
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, '.spyglass-import-'));
  try {
    await cp(source, staging, { recursive: true, dereference: false });
    await assertNoSymlinks(staging);
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/** L7-154: unlink without following so a copied symlink cannot redirect the write. */
async function unlinkIfPresent(path: string): Promise<void> {
  try {
    const st = await lstat(path);
    if (st.isSymbolicLink() || st.isFile()) {
      await unlink(path);
      return;
    }
    throw new Error('export refused: spyglass-session.json is not a regular file');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/** O7a: do not silently destroy a non-empty folder the user picked. */
async function assertExportDestAvailable(dest: string): Promise<void> {
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw err;
  }
  if (!st.isDirectory()) {
    throw new Error('export refused: destination already exists');
  }
  const names = await readdir(dest);
  if (names.length > 0) {
    throw new Error('export refused: destination is not empty');
  }
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

/** L7-039: import must not copy symlinks (escape / TOCTOU). */
async function assertNoSymlinks(root: string): Promise<void> {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    const st = await lstat(current);
    if (st.isSymbolicLink()) {
      throw new Error('import refused: symlinks are not allowed');
    }
    if (!st.isDirectory()) {
      continue;
    }
    const names = await readdir(current);
    for (const name of names) {
      stack.push(join(current, name));
    }
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

async function recoverOrphanedBackup(dest: string): Promise<void> {
  const parent = dirname(dest);
  const base = basename(dest);
  let names: string[];
  try {
    names = await readdir(parent);
  } catch {
    return;
  }
  const orphans = names
    .filter((name) => name === `${base}.spyglass-prev` || name.startsWith(`${base}.spyglass-prev-`))
    .map((name) => join(parent, name));
  if (orphans.length === 0) {
    return;
  }
  try {
    await lstat(dest);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      return;
    }
  }
  const ranked: Array<{ path: string; mtimeMs: number }> = [];
  for (const path of orphans) {
    try {
      const st = await lstat(path);
      ranked.push({ path, mtimeMs: st.mtimeMs });
    } catch {
      // skip unreadable orphans
    }
  }
  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  const newest = ranked[0];
  if (newest === undefined) {
    return;
  }
  await rename(newest.path, dest);
  for (const extra of ranked.slice(1)) {
    await rm(extra.path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** L7-030 / L7-040 / L7-051: unique backup per replace; restore dest if publish fails.
 * L7-063: orphan recovery runs in export/import *before* O7a/I7a dest checks. */
async function replaceDirectory(dest: string, staging: string): Promise<void> {
  const backup = `${dest}.spyglass-prev-${randomBytes(8).toString('hex')}`;
  let backedUp = false;
  let published = false;
  try {
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
    published = true;
    if (backedUp) {
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (backedUp && !published) {
      // L7-163: dest is not our published staging; do not rm a concurrent dest.
      try {
        await rename(backup, dest);
      } catch (restoreError) {
        // L7-169: keep the original publish error; log a stuck orphan so it is visible.
        console.error(
          `[spyglass] failed to restore ${dest} from ${backup} after publish failure: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`
        );
      }
    }
    throw error;
  }
}
