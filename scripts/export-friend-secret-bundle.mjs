import { chmod, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FRIEND_SECRET_ALLOWLIST,
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const source = args.get('--source');
const output = args.get('--output');
if (!path.isAbsolute(source || '') || !path.isAbsolute(output || '')) throw new Error('absolute_paths_required');

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (rootResult.status !== 0) throw new Error('git_worktree_required');
const root = await realpath(rootResult.stdout.trim());
const outputParent = await realpath(path.dirname(output));
const canonicalOutput = path.join(outputParent, path.basename(output));
if (canonicalOutput === root || canonicalOutput.startsWith(root + path.sep)) {
  throw new Error('output_inside_git_worktree');
}

const sourceEntries = parseDotenvText(await readFile(source, 'utf8'));
const selected = new Map([...FRIEND_SECRET_ALLOWLIST]
  .filter((key) => String(sourceEntries.get(key) || '').trim())
  .map((key) => [key, sourceEntries.get(key)]));
const validation = validateFriendSecretEntries(selected);
if (!validation.ok) throw new Error(`invalid_friend_bundle:${validation.rejectedKeys.join(',')}`);

const temporary = `${canonicalOutput}.tmp-${process.pid}`;
let temporaryCreated = false;
try {
  await writeFile(temporary, serializeDotenv(selected), { mode: 0o600, flag: 'wx' });
  temporaryCreated = true;
  await chmod(temporary, 0o600);
  await rename(temporary, canonicalOutput);
  temporaryCreated = false;
} catch (error) {
  if (temporaryCreated) await unlink(temporary).catch(() => {});
  throw error;
}
console.log(JSON.stringify({
  outputPath: canonicalOutput,
  exportedKeys: validation.keys,
  omittedKeys: [...FRIEND_SECRET_ALLOWLIST].filter((key) => !selected.has(key)).sort(),
  cosRisk: validation.keys.some((key) => key.includes('_COS_')),
}));
