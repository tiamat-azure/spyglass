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
  rmdir,
  unlink,
  writeFile
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const SESSION_BUNDLE_MANIFEST = 'spyglass-session.json';

export const SESSION_BUNDLE_ERROR_TAG = 'spyglass.session-bundle' as const;

export type SessionBundleIpcCode =
  | 'dest-not-empty'
  | 'dest-not-directory'
  | 'session-exists'
  | 'invalid-session'
  | 'overlap'
  | 'symlink'
  | 'invalid-meta';

/** L7-233: structured codes so IPC mapping does not depend on Error.message text. */
export class SessionBundleError extends Error {
  readonly tag: typeof SESSION_BUNDLE_ERROR_TAG = SESSION_BUNDLE_ERROR_TAG;
  readonly bundleCode: SessionBundleIpcCode;
  constructor(bundleCode: SessionBundleIpcCode, message: string) {
    super(message);
    this.name = 'SessionBundleError';
    this.bundleCode = bundleCode;
  }
}

export function isSessionBundleError(error: unknown): error is SessionBundleError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { tag?: unknown }).tag === SESSION_BUNDLE_ERROR_TAG
  );
}

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
  const source = resolve(sessionDir);
  const dest = resolve(destDir);
  await assertNoSymlinks(source, 'export');
  const meta = await readSessionMeta(sessionDir);
  await assertNoCopyOverlap(source, dest);
  return await withDestLock(dest, async () => {
    await recoverOrphanedBackup(dest);
    // O29b: a file (or other non-dir) at dest is never moved/deleted, even with overwrite.
    await assertExportDestIsDirectoryIfPresent(dest);
    if (!overwrite) {
      await assertExportDestAvailable(dest);
    }
    const parent = dirname(dest);
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(join(parent, '.spyglass-export-'));
    try {
      await cp(source, staging, { recursive: true, dereference: false });
      await assertNoSymlinks(staging, 'export');
      const manifest: SessionBundleManifest = {
        schemaVersion: 1,
        kind: 'spyglass-session',
        sessionId: meta.sessionId,
        exportedAt: now.toISOString()
      };
      const manifestPath = join(staging, SESSION_BUNDLE_MANIFEST);
      await unlinkIfPresent(manifestPath);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await replaceDirectory(dest, staging, {
        overwrite,
        existsError: 'export refused: destination already exists',
        existsCode: 'dest-not-empty',
        allowEmptyDest: !overwrite
      });
      return { dest, sessionId: meta.sessionId, manifestPath: join(dest, SESSION_BUNDLE_MANIFEST) };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
}

export async function importSessionFolder(
  bundleDir: string,
  sessionsRoot: string
): Promise<{ sessionDir: string; sessionId: string }> {
  const source = resolve(bundleDir);
  await assertNoSymlinks(source, 'import');
  const meta = await readSessionMeta(source);
  const sessionId = meta.sessionId;
  if (!isSafeSessionId(sessionId)) {
    throw new SessionBundleError('invalid-session', 'import refused: invalid sessionId');
  }
  const root = resolve(sessionsRoot);
  const dest = resolve(root, sessionId);
  if (!isInsideSessionsRoot(root, dest)) {
    throw new SessionBundleError('invalid-session', 'import refused: invalid sessionId');
  }
  await assertNoCopyOverlap(source, dest);
  await assertBundleManifestAgrees(source, sessionId);
  return await withDestLock(dest, async () => {
    await recoverOrphanedBackup(dest);
    if (await pathExists(dest)) {
      throw new SessionBundleError('session-exists', 'import refused: session already exists');
    }
    await mkdir(root, { recursive: true });
    const staging = await mkdtemp(join(root, '.spyglass-import-'));
    try {
      await cp(source, staging, { recursive: true, dereference: false });
      await assertNoSymlinks(staging, 'import');
      await replaceDirectory(dest, staging, {
        overwrite: false,
        existsError: 'import refused: session already exists',
        existsCode: 'session-exists'
      });
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { sessionDir: dest, sessionId };
  });
}

export async function readSessionMeta(sessionDir: string): Promise<{ sessionId: string }> {
  let rawText: string;
  try {
    rawText = await readFile(join(sessionDir, 'meta.json'), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new SessionBundleError('invalid-meta', 'session meta.json is missing');
    }
    throw new SessionBundleError(
      'invalid-meta',
      `session meta.json is unreadable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new SessionBundleError('invalid-meta', 'session meta.json is invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SessionBundleError('invalid-meta', 'session meta.json is not an object');
  }
  const raw = parsed as { sessionId?: unknown };
  if (typeof raw.sessionId !== 'string' || raw.sessionId.trim().length === 0) {
    throw new SessionBundleError('invalid-meta', 'session meta.json is missing sessionId');
  }
  return { sessionId: raw.sessionId };
}

/** L7-187: import only a bundle whose manifest matches meta.json. */
async function assertBundleManifestAgrees(dir: string, sessionId: string): Promise<void> {
  let rawText: string;
  try {
    rawText = await readFile(join(dir, SESSION_BUNDLE_MANIFEST), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new SessionBundleError('invalid-meta', 'import refused: missing spyglass-session.json');
    }
    throw new SessionBundleError(
      'invalid-meta',
      'import refused: unreadable spyglass-session.json'
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new SessionBundleError('invalid-meta', 'import refused: invalid spyglass-session.json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SessionBundleError('invalid-meta', 'import refused: invalid spyglass-session.json');
  }
  const record = parsed as { schemaVersion?: unknown; kind?: unknown; sessionId?: unknown };
  if (record.schemaVersion !== 1) {
    throw new SessionBundleError(
      'invalid-meta',
      'import refused: spyglass-session.json schemaVersion'
    );
  }
  if (record.kind !== 'spyglass-session') {
    throw new SessionBundleError('invalid-meta', 'import refused: spyglass-session.json kind');
  }
  if (typeof record.sessionId !== 'string' || record.sessionId !== sessionId) {
    throw new SessionBundleError(
      'invalid-meta',
      'import refused: spyglass-session.json sessionId does not match meta.json'
    );
  }
}

/**
 * L7-186 / X28a: in-process dest mutex (in-memory `destLocks` Map). Same-process
 * concurrent import/export cannot clobber the same dest. Not a
 * cross-process lockfile — separate processes can still race. No lockfile
 * this lot.
 */
const destLocks = new Map<string, Promise<void>>();

/** L7-186 / L7-207 / X28a: single-process queue; see destLocks comment. */
async function withDestLock<T>(dest: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(dest);
  const previous = destLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolveHeld) => {
    release = resolveHeld;
  });
  // L7-207: store the same promise we later compare for cleanup.
  const queued = previous.then(() => held);
  destLocks.set(key, queued);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (destLocks.get(key) === queued) {
      destLocks.delete(key);
    }
  }
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
    throw new SessionBundleError(
      'symlink',
      'export refused: spyglass-session.json is not a regular file'
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/** O29b: refuse a file/symlink/special dest; do not move or delete it. */
async function assertExportDestIsDirectoryIfPresent(dest: string): Promise<void> {
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
    throw new SessionBundleError(
      'dest-not-directory',
      'export refused: destination is not a directory'
    );
  }
}

/** O7a: do not silently destroy a non-empty folder the user picked. */
async function assertExportDestAvailable(dest: string): Promise<void> {
  await assertExportDestIsDirectoryIfPresent(dest);
  let names: string[];
  try {
    names = await readdir(dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw err;
  }
  if (names.length > 0) {
    throw new SessionBundleError('dest-not-empty', 'export refused: destination is not empty');
  }
}

/**
 * L7-013: never `rm(dest)` when dest is the source (or either contains the other).
 */
async function assertNoCopyOverlap(source: string, dest: string): Promise<void> {
  const sourceReal = await realpathExisting(source);
  const destReal = await realpathExisting(dest);
  if (sourceReal === destReal) {
    throw new SessionBundleError(
      'overlap',
      'session copy refused: destination must not be the source session'
    );
  }
  const destInsideSource = isInsideSessionsRoot(sourceReal, destReal);
  const sourceInsideDest = isInsideSessionsRoot(destReal, sourceReal);
  if (destInsideSource || sourceInsideDest) {
    throw new SessionBundleError(
      'overlap',
      'session copy refused: destination must not overlap the source session'
    );
  }
}

/** L7-039 / L7-198 / L7-219: refuse symlinks and non-regular special files. */
async function assertNoSymlinks(root: string, action: 'import' | 'export'): Promise<void> {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    const st = await lstat(current);
    if (st.isSymbolicLink()) {
      throw new SessionBundleError('symlink', `${action} refused: symlinks are not allowed`);
    }
    if (st.isDirectory()) {
      const names = await readdir(current);
      for (const name of names) {
        stack.push(join(current, name));
      }
      continue;
    }
    if (!st.isFile()) {
      throw new SessionBundleError('symlink', `${action} refused: special files are not allowed`);
    }
  }
}

async function realpathExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch (parentError) {
      if (!isMissingPathError(parentError)) {
        throw parentError;
      }
      return resolve(path);
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * W26a: Windows `rename(staging, dest)` fails when dest already exists as an
 * empty directory (folder picker). Remove only a still-empty dest.
 * Non-empty dest is left in place (O7a / L7-186).
 */
async function vacateEmptyDirectory(dest: string): Promise<boolean> {
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw err;
  }
  if (!st.isDirectory()) {
    return false;
  }
  const names = await readdir(dest);
  if (names.length > 0) {
    return false;
  }
  await rmdir(dest);
  return true;
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
  const ownedPrefix = `${base}.spyglass-prev-`;
  const ownedExact = `${base}.spyglass-prev`;
  const orphans = names
    .filter((name) => name === ownedExact || name.startsWith(ownedPrefix))
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
      // L7-260: only resurrect a directory this dest uniquely owns.
      if (!st.isDirectory()) {
        continue;
      }
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
  try {
    await rename(newest.path, dest);
  } catch {
    return;
  }
  for (const extra of ranked.slice(1)) {
    await rm(extra.path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** L7-030 / L7-040 / L7-051: unique backup per replace; restore dest if publish fails.
 * L7-063: orphan recovery runs in export/import *before* O7a/I7a dest checks.
 * L7-186: when overwrite is false, publish with no-replace rename (do not backup-and-steal).
 * W26a: export may vacate an existing empty dest (Windows folder picker) then rename. */
async function replaceDirectory(
  dest: string,
  staging: string,
  options: {
    overwrite: boolean;
    existsError: string;
    existsCode: SessionBundleIpcCode;
    allowEmptyDest?: boolean;
  }
): Promise<void> {
  if (!options.overwrite) {
    if (options.allowEmptyDest === true) {
      await vacateEmptyDirectory(dest);
    }
    // L7-259: do not rely on POSIX rename replacing an existing dest (empty or
    // not). Vacate empty dirs explicitly (W26a), then refuse if dest still exists.
    if (await pathExists(dest)) {
      throw new SessionBundleError(options.existsCode, options.existsError);
    }
    await rename(staging, dest);
    return;
  }
  // O29b: never rename/rm a non-directory dest (file-at-dest), even with overwrite.
  try {
    const destStat = await lstat(dest);
    if (!destStat.isDirectory()) {
      throw new SessionBundleError(
        'dest-not-directory',
        'export refused: destination is not a directory'
      );
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw err;
    }
  }
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
