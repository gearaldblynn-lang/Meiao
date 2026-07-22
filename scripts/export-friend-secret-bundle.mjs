import { readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FRIEND_SECRET_ALLOWLIST,
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';
import {
  installFileNoReplace,
  writeExclusive0600,
} from './secret-bundle-file-ops.mjs';

const rawArgs = process.argv.slice(2);
if (rawArgs.length !== 4) {
  throw new Error('usage: secrets:export -- --source ABSOLUTE_PATH --output ABSOLUTE_PATH');
}
const args = new Map();
for (let index = 0; index < rawArgs.length; index += 2) {
  const flag = rawArgs[index];
  if (!['--source', '--output'].includes(flag) || args.has(flag) || rawArgs[index + 1] === undefined) {
    throw new Error('invalid_export_arguments');
  }
  args.set(flag, rawArgs[index + 1]);
}
const source = args.get('--source');
const output = args.get('--output');
if (!source || !output) throw new Error('invalid_export_arguments');
if (!path.isAbsolute(source || '') || !path.isAbsolute(output || '')) throw new Error('absolute_paths_required');

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (rootResult.status !== 0) throw new Error('git_worktree_required');
const root = await realpath(rootResult.stdout.trim());
const outputParent = await realpath(path.dirname(output));
const canonicalOutput = path.join(outputParent, path.basename(output));
if (canonicalOutput === root || canonicalOutput.startsWith(root + path.sep)) {
  throw new Error('output_inside_git_worktree');
}
const canonicalSource = await realpath(source);
const existingCanonicalOutput = await realpath(canonicalOutput).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (
  path.normalize(source) === canonicalOutput
  || canonicalSource === canonicalOutput
  || canonicalSource === existingCanonicalOutput
) {
  throw new Error('source_and_output_must_differ');
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
  await writeExclusive0600(temporary, serializeDotenv(selected));
  temporaryCreated = true;
  await installFileNoReplace(temporary, canonicalOutput);
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
