import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ownership = await import('./deploy-ownership.mjs').catch(() => ({}));

const withTempDir = (run) => {
  const directory = mkdtempSync(join(tmpdir(), 'meiao-deploy-ownership-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('active marker creation is exclusive and never overwrites an empty marker', () => withTempDir((dir) => {
  const markerFile = join(dir, 'drain.marker');
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  writeFileSync(markerFile, '');

  assert.throws(
    () => ownership.createOwnedDeployMarker({ markerFile, mutexDir, ownerToken: 'owner-a' }),
    /already exists/,
  );
  assert.equal(readFileSync(markerFile, 'utf8'), '');
}));

test('active and manual markers remain readable by the unprivileged app process', () => withTempDir((dir) => {
  const markerFile = join(dir, 'drain.marker');
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.createOwnedDeployMarker({ markerFile, mutexDir, ownerToken: 'owner-a' });

  assert.equal(statSync(markerFile).mode & 0o777, 0o644);
  assert.equal(readFileSync(markerFile, 'utf8'), 'owner-a\n');

  const retained = ownership.retainManualDeployMarker({
    markerFile,
    mutexDir,
    ownerToken: 'owner-a',
  });
  assert.equal(retained.retained, true);
  assert.equal(statSync(markerFile).mode & 0o777, 0o644);
  assert.equal(readFileSync(markerFile, 'utf8'), 'manual\n');
}));

test('marker removal deletes only the claimed owner marker and leaves a replacement untouched', () => withTempDir((dir) => {
  const markerFile = join(dir, 'drain.marker');
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.createOwnedDeployMarker({ markerFile, mutexDir, ownerToken: 'owner-a' });

  const result = ownership.removeOwnedDeployMarker({
    markerFile,
    mutexDir,
    ownerToken: 'owner-a',
    afterClaim: () => writeFileSync(markerFile, 'replacement\n', { flag: 'wx' }),
  });

  assert.equal(result.removed, true);
  assert.equal(readFileSync(markerFile, 'utf8'), 'replacement\n');
}));

test('marker restore retains its private claim when a new live marker appears', () => withTempDir((dir) => {
  const markerFile = join(dir, 'drain.marker');
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  writeFileSync(markerFile, 'manual\n');

  const result = ownership.removeOwnedDeployMarker({
    markerFile,
    mutexDir,
    ownerToken: 'owner-a',
    afterClaim: () => writeFileSync(markerFile, 'replacement\n', { flag: 'wx' }),
  });

  assert.equal(result.removed, false);
  assert.equal(result.restored, false);
  assert.equal(readFileSync(markerFile, 'utf8'), 'replacement\n');
  assert.equal(readFileSync(result.claimPath, 'utf8'), 'manual\n');
}));

test('private marker claim ignores a preexisting predictable-looking external path', () => withTempDir((dir) => {
  const markerFile = join(dir, 'drain.marker');
  const mutexDir = join(dir, 'mutex');
  const externalPath = `${markerFile}.quarantine-owner-a`;
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.createOwnedDeployMarker({ markerFile, mutexDir, ownerToken: 'owner-a' });
  writeFileSync(externalPath, 'external-sentinel\n');

  const result = ownership.removeOwnedDeployMarker({ markerFile, mutexDir, ownerToken: 'owner-a' });

  assert.equal(result.removed, true);
  assert.equal(readFileSync(externalPath, 'utf8'), 'external-sentinel\n');
}));

test('foreign marker content is restored instead of deleted after an atomic claim', () => withTempDir((dir) => {
  const markerFile = join(dir, 'drain.marker');
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  writeFileSync(markerFile, 'manual\n');

  const result = ownership.removeOwnedDeployMarker({ markerFile, mutexDir, ownerToken: 'owner-a' });

  assert.equal(result.removed, false);
  assert.equal(result.restored, true);
  assert.equal(readFileSync(markerFile, 'utf8'), 'manual\n');
}));

test('mutation-started mutex release retains the live lock without matching completion proof', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: true,
  });

  assert.equal(result.released, false);
  assert.equal(result.reason, 'completion_missing');
  assert.equal(readFileSync(join(mutexDir, 'owner'), 'utf8'), 'owner-a\n');
}));

test('owner-matched mutex release before remote mutation does not require completion proof', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: false,
  });

  assert.equal(result.released, true);
  assert.equal(ownership.pathExists(mutexDir), false);
}));

test('matching remote completion permits atomic mutex release', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.recordRemoteMutationCompletion({ mutexDir, ownerToken: 'owner-a' });

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: true,
  });

  assert.equal(result.released, true);
  assert.equal(ownership.pathExists(mutexDir), false);
}));

test('mutex release removes only its claimed directory and leaves a replacement lock untouched', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.recordRemoteMutationCompletion({ mutexDir, ownerToken: 'owner-a' });

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: true,
    afterClaim: () => {
      mkdirSync(mutexDir);
      writeFileSync(join(mutexDir, 'owner'), 'owner-b\n', { flag: 'wx' });
    },
  });

  assert.equal(result.released, true);
  assert.equal(readFileSync(join(mutexDir, 'owner'), 'utf8'), 'owner-b\n');
}));

test('mutex mismatch restore retains its private claim when a new live mutex appears', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.recordRemoteMutationCompletion({ mutexDir, ownerToken: 'owner-a' });

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: true,
    afterClaim: ({ claimPath }) => {
      writeFileSync(join(claimPath, 'owner'), 'foreign-owner\n');
      mkdirSync(mutexDir);
      writeFileSync(join(mutexDir, 'owner'), 'owner-b\n', { flag: 'wx' });
    },
  });

  assert.equal(result.released, false);
  assert.equal(result.restored, false);
  assert.equal(readFileSync(join(mutexDir, 'owner'), 'utf8'), 'owner-b\n');
  assert.equal(readFileSync(join(result.claimPath, 'owner'), 'utf8'), 'foreign-owner\n');
}));

test('mutex mismatch restore recreates live state exclusively and removes its private claim', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.recordRemoteMutationCompletion({ mutexDir, ownerToken: 'owner-a' });
  let claimParent;

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: true,
    afterClaim: (claim) => {
      claimParent = claim.claimParent;
      writeFileSync(join(claim.claimPath, 'owner'), 'foreign-owner\n');
    },
  });

  assert.equal(result.released, false);
  assert.equal(result.restored, true);
  assert.equal(readFileSync(join(mutexDir, 'owner'), 'utf8'), 'foreign-owner\n');
  assert.equal(existsSync(claimParent), false);
}));

test('private mutex claim ignores a preexisting predictable-looking external path', () => withTempDir((dir) => {
  const mutexDir = join(dir, 'mutex');
  const externalPath = `${mutexDir}.release-owner-a`;
  ownership.acquireDeployMutex({ mutexDir, ownerToken: 'owner-a' });
  ownership.recordRemoteMutationCompletion({ mutexDir, ownerToken: 'owner-a' });
  mkdirSync(externalPath);
  writeFileSync(join(externalPath, 'sentinel'), 'external-sentinel\n');

  const result = ownership.releaseDeployMutex({
    mutexDir,
    ownerToken: 'owner-a',
    mutationStarted: true,
  });

  assert.equal(result.released, true);
  assert.equal(existsSync(mutexDir), false);
  assert.equal(readFileSync(join(externalPath, 'sentinel'), 'utf8'), 'external-sentinel\n');
}));
