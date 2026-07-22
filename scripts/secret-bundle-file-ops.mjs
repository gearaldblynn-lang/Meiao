import { constants } from 'node:fs';
import { link, lstat, open, unlink } from 'node:fs/promises';

const SNAPSHOT_FIELDS = ['dev', 'ino', 'size', 'mtimeNs'];

function fileSnapshotChanged() {
  return new Error('file_snapshot_changed');
}

function regularFileRequired() {
  return new Error('regular_file_required');
}

function sameSnapshotMetadata(left, right) {
  return SNAPSHOT_FIELDS.every((field) => left[field] === right[field]);
}

async function removeOwnedPath(targetPath, ownership) {
  let current;
  try {
    current = await lstat(targetPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (current.dev !== ownership.dev || current.ino !== ownership.ino) return;
  await unlink(targetPath);
}

export async function acquireExclusiveLock(lockPath) {
  let handle;
  let ownership;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    await handle.chmod(0o600);
    ownership = await handle.stat({ bigint: true });
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (ownership) await removeOwnedPath(lockPath, ownership).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await removeOwnedPath(lockPath, ownership);
    },
  };
}

export async function readRegularFileSnapshot(targetPath) {
  let pathStat;
  try {
    pathStat = await lstat(targetPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  }
  if (!pathStat.isFile()) throw regularFileRequired();

  const readFlags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
  const handle = await open(targetPath, readFlags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameSnapshotMetadata(pathStat, before)) {
      throw fileSnapshotChanged();
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(targetPath, { bigint: true });
    if (
      !pathAfter.isFile()
      || !sameSnapshotMetadata(before, after)
      || !sameSnapshotMetadata(after, pathAfter)
      || BigInt(bytes.byteLength) !== after.size
    ) {
      throw fileSnapshotChanged();
    }
    return {
      exists: true,
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      mtimeNs: after.mtimeNs,
      bytes,
      text: bytes.toString('utf8'),
    };
  } finally {
    await handle.close();
  }
}

export async function assertFileSnapshotUnchanged(targetPath, snapshot) {
  const current = await readRegularFileSnapshot(targetPath);
  if (snapshot.exists !== current.exists) throw fileSnapshotChanged();
  if (!snapshot.exists) return;
  if (!sameSnapshotMetadata(snapshot, current) || !snapshot.bytes.equals(current.bytes)) {
    throw fileSnapshotChanged();
  }
}

export async function writeExclusive0600(targetPath, text) {
  let handle;
  let ownership;
  try {
    handle = await open(targetPath, 'wx', 0o600);
    ownership = await handle.stat({ bigint: true });
    await handle.chmod(0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (ownership) await removeOwnedPath(targetPath, ownership).catch(() => {});
    throw error;
  }
}

export async function installFileNoReplace(temporaryPath, finalPath) {
  await link(temporaryPath, finalPath);
  await unlink(temporaryPath);
}
