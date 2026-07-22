import { readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FRIEND_SECRET_ALLOWLIST,
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';
import {
  acquireExclusiveLock,
  assertFileSnapshotUnchanged,
  installFileNoReplace,
  readRegularFileSnapshot,
  writeExclusive0600,
} from './secret-bundle-file-ops.mjs';

const rawArgs = process.argv.slice(2);
if (!(rawArgs.length === 1 || (rawArgs.length === 2 && rawArgs[1] === '--force'))) {
  throw new Error('usage: secrets:import -- /absolute/path/.env.meiao.friend [--force]');
}
const bundleArgument = rawArgs[0];
const force = rawArgs.length === 2;
if (!path.isAbsolute(bundleArgument || '')) throw new Error('absolute_bundle_path_required');

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (rootResult.status !== 0) throw new Error('git_worktree_required');
const root = await realpath(rootResult.stdout.trim());
const bundle = await realpath(bundleArgument);
if (bundle === root || bundle.startsWith(root + path.sep)) {
  const relative = path.relative(root, bundle);
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', relative], { cwd: root });
  if (ignored.status !== 0) throw new Error('in_repo_bundle_must_be_gitignored');
}

const examplePath = path.join(root, '.env.server.example');
const targetPath = path.join(root, '.env.server');
const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
const backupPath = `${targetPath}.backup-${timestamp}`;
const temporary = `${targetPath}.tmp-${process.pid}`;
const lock = await acquireExclusiveLock(`${targetPath}.import.lock`);
let temporaryCreated = false;
let report;
try {
  const snapshot = await readRegularFileSnapshot(targetPath);
  const current = snapshot.exists ? parseDotenvText(snapshot.text) : new Map();
  const example = parseDotenvText(await readFile(examplePath, 'utf8'));
  const incoming = parseDotenvText(await readFile(bundle, 'utf8'));
  const validation = validateFriendSecretEntries(incoming);
  if (!validation.ok) throw new Error(`invalid_friend_bundle:${validation.rejectedKeys.join(',')}`);

  const merged = new Map([...example, ...current]);
  const importedKeys = [];
  const preservedKeys = [];
  for (const [key, value] of incoming) {
    if (!force && String(current.get(key) || '').trim()) preservedKeys.push(key);
    else {
      merged.set(key, value);
      importedKeys.push(key);
    }
  }

  if (snapshot.exists) await writeExclusive0600(backupPath, snapshot.bytes);
  await writeExclusive0600(temporary, serializeDotenv(merged));
  temporaryCreated = true;
  await assertFileSnapshotUnchanged(targetPath, snapshot);
  if (snapshot.exists) await rename(temporary, targetPath);
  else await installFileNoReplace(temporary, targetPath);
  temporaryCreated = false;
  report = {
    importedKeys: importedKeys.sort(),
    preservedKeys: preservedKeys.sort(),
    missingKeys: [...FRIEND_SECRET_ALLOWLIST]
      .filter((key) => !String(merged.get(key) || '').trim())
      .sort(),
    backupCreated: snapshot.exists,
    cosRisk: [...incoming.keys()].some((key) => key.includes('_COS_')),
    nextCommand: 'npm run doctor',
  };
} finally {
  if (temporaryCreated) await unlink(temporary).catch(() => {});
  await lock.release();
}
console.log(JSON.stringify(report));
