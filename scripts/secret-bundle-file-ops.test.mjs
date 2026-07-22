import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  readFile,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireExclusiveLock,
  assertFileSnapshotUnchanged,
  installFileNoReplace,
  readRegularFileSnapshot,
  writeExclusive0600,
} from './secret-bundle-file-ops.mjs';

async function makeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'meiao-secret-file-ops-'));
}

test('readRegularFileSnapshot rejects symlinks and non-regular files', async () => {
  const root = await makeTempDir();
  const regular = path.join(root, 'regular');
  const linked = path.join(root, 'linked');
  await writeFile(regular, 'snapshot-bytes');
  await symlink(regular, linked);

  await assert.rejects(readRegularFileSnapshot(linked), /regular_file_required/);
  await assert.rejects(readRegularFileSnapshot(root), /regular_file_required/);
});

test('assertFileSnapshotUnchanged detects byte drift even when metadata matches', async () => {
  const root = await makeTempDir();
  const target = path.join(root, 'target');
  await writeFile(target, 'first-bytes!');
  const original = await readRegularFileSnapshot(target);
  await writeFile(target, 'other-bytes!');
  const current = await readRegularFileSnapshot(target);
  const forgedMetadataMatch = {
    ...original,
    dev: current.dev,
    ino: current.ino,
    size: current.size,
    mtimeNs: current.mtimeNs,
  };

  await assert.rejects(
    assertFileSnapshotUnchanged(target, forgedMetadataMatch),
    /file_snapshot_changed/,
  );
});

test('assertFileSnapshotUnchanged detects inode replacement with equal bytes', async () => {
  const root = await makeTempDir();
  const target = path.join(root, 'target');
  const displaced = path.join(root, 'displaced');
  await writeFile(target, 'equal-content');
  const snapshot = await readRegularFileSnapshot(target);
  await rename(target, displaced);
  await writeFile(target, 'equal-content');

  await assert.rejects(assertFileSnapshotUnchanged(target, snapshot), /file_snapshot_changed/);
});

test('an initially absent snapshot rejects a target that appears before commit', async () => {
  const root = await makeTempDir();
  const target = path.join(root, 'target');
  const snapshot = await readRegularFileSnapshot(target);
  assert.equal(snapshot.exists, false);
  await writeFile(target, 'appeared');

  await assert.rejects(assertFileSnapshotUnchanged(target, snapshot), /file_snapshot_changed/);
});

test('installFileNoReplace refuses an existing final path and preserves both files', async () => {
  const root = await makeTempDir();
  const temporary = path.join(root, 'temporary');
  const final = path.join(root, 'final');
  await writeFile(temporary, 'new-content', { mode: 0o600 });
  await writeFile(final, 'existing-content', { mode: 0o600 });

  await assert.rejects(installFileNoReplace(temporary, final), { code: 'EEXIST' });
  assert.equal(await readFile(temporary, 'utf8'), 'new-content');
  assert.equal(await readFile(final, 'utf8'), 'existing-content');
});

test('writeExclusive0600 creates a closed, fsynced, mode-0600 file without replacement', async () => {
  const root = await makeTempDir();
  const target = path.join(root, 'backup');
  await writeExclusive0600(target, 'snapshot-backup');

  assert.equal(await readFile(target, 'utf8'), 'snapshot-backup');
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  await assert.rejects(writeExclusive0600(target, 'replacement'), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'snapshot-backup');
});

test('exclusive lock rejects competitors and release removes only its own inode', async () => {
  const root = await makeTempDir();
  const lockPath = path.join(root, 'import.lock');
  const lock = await acquireExclusiveLock(lockPath);
  assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
  await assert.rejects(acquireExclusiveLock(lockPath), { code: 'EEXIST' });

  await unlink(lockPath);
  await writeFile(lockPath, 'foreign-lock', { mode: 0o600 });
  const foreignInode = (await lstat(lockPath, { bigint: true })).ino;
  await lock.release();

  assert.equal(await readFile(lockPath, 'utf8'), 'foreign-lock');
  assert.equal((await lstat(lockPath, { bigint: true })).ino, foreignInode);
});

test('exclusive lock release is idempotent for the lock it acquired', async () => {
  const root = await makeTempDir();
  const lockPath = path.join(root, 'import.lock');
  const lock = await acquireExclusiveLock(lockPath);

  await lock.release();
  await lock.release();
  await assert.rejects(lstat(lockPath), { code: 'ENOENT' });
});
