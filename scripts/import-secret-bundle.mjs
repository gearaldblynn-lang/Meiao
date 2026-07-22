import { constants } from 'node:fs';
import { chmod, copyFile, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FRIEND_SECRET_ALLOWLIST,
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';

const positional = process.argv.slice(2).filter((arg) => arg !== '--force');
const force = process.argv.slice(2).includes('--force');
if (positional.length !== 1) throw new Error('usage: secrets:import -- /absolute/path/.env.meiao.friend [--force]');
if (!path.isAbsolute(positional[0])) throw new Error('absolute_bundle_path_required');

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (rootResult.status !== 0) throw new Error('git_worktree_required');
const root = await realpath(rootResult.stdout.trim());
const bundle = await realpath(positional[0]);
if (bundle === root || bundle.startsWith(root + path.sep)) {
  const relative = path.relative(root, bundle);
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', relative], { cwd: root });
  if (ignored.status !== 0) throw new Error('in_repo_bundle_must_be_gitignored');
}

const examplePath = path.join(root, '.env.server.example');
const targetPath = path.join(root, '.env.server');
const example = parseDotenvText(await readFile(examplePath, 'utf8'));
const currentText = await readFile(targetPath, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const current = currentText === null ? new Map() : parseDotenvText(currentText);
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

const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
const backupPath = `${targetPath}.backup-${timestamp}`;
const temporary = `${targetPath}.tmp-${process.pid}`;
let temporaryCreated = false;
try {
  if (currentText !== null) {
    await copyFile(targetPath, backupPath, constants.COPYFILE_EXCL);
    await chmod(backupPath, 0o600);
  }
  await writeFile(temporary, serializeDotenv(merged), { mode: 0o600, flag: 'wx' });
  temporaryCreated = true;
  await chmod(temporary, 0o600);
  await rename(temporary, targetPath);
  temporaryCreated = false;
} catch (error) {
  if (temporaryCreated) await unlink(temporary).catch(() => {});
  throw error;
}
console.log(JSON.stringify({
  importedKeys: importedKeys.sort(),
  preservedKeys: preservedKeys.sort(),
  missingKeys: [...FRIEND_SECRET_ALLOWLIST].filter((key) => !String(merged.get(key) || '').trim()).sort(),
  backupCreated: currentText !== null,
  cosRisk: [...incoming.keys()].some((key) => key.includes('_COS_')),
  nextCommand: 'npm run doctor',
}));
