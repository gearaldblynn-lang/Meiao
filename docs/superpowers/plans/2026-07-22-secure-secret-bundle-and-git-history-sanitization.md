# Secure Secret Bundle and Git History Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed live provider credential from every public Git ref, rotate it in production, and provide a repository-external `.env.meiao.friend` bundle that a friend can import with one command without receiving production database, SSH, or administrator credentials.

**Architecture:** A shared secret-policy module owns the provider/COS allowlist and forbidden infrastructure keys. Public CLI tools validate, export, and atomically import dotenv bundles without logging values; a tracked-file scanner runs inside `npm run verify`. Operationally, rotate the exposed key first, export only allowlisted values, then rewrite every Git branch and tag in an isolated mirror by matching the exposed key's SHA-256 fingerprint.

**Tech Stack:** Node.js ESM, Node test runner, dotenv-compatible text, Git, `git-filter-repo` in an ephemeral Python target directory, SSH/SCP, existing Tencent deployment and health probes.

## Global Constraints

- Never print, log, hash-report, commit, or place a real secret in a shell argument.
- The friend bundle may contain approved provider and COS keys, but never production database, SSH, GitHub, administrator, session, or managed-asset capability secrets.
- The exposed `OPENAI_COMPATIBLE_API_KEY` must be rotated and revoked before the final friend bundle is produced.
- Paid provider creation probes remain forbidden; verification uses configuration, health, and non-paid authentication checks.
- Git history rewriting covers every remote branch and tag and must not delete unrelated refs.
- Existing collaborators must re-clone after history rewriting.
- The exposed-key fingerprint is supplied at execution time from a local `0600` file outside Git; the plan and command line contain neither the credential nor its fingerprint.

---

### Task 1: Centralize the secret bundle policy and dotenv parser

**Files:**
- Create: `scripts/secret-bundle-policy.mjs`
- Create: `scripts/secret-bundle-policy.test.mjs`

**Interfaces:**
- Produces: `FRIEND_SECRET_ALLOWLIST: ReadonlySet<string>`, `FRIEND_SECRET_FORBIDDEN: ReadonlySet<string>`, `parseDotenvText(text: string): Map<string,string>`, `serializeDotenv(entries: Map<string,string>): string`, `validateFriendSecretEntries(entries: Map<string,string>): { ok: true, keys: string[] } | { ok: false, rejectedKeys: string[], reasons: Record<string,string> }`.
- Consumes: no application runtime state; this module is CLI-only.

- [ ] **Step 1: Write failing policy tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';

test('friend bundle accepts provider and COS keys without exposing values', () => {
  const entries = parseDotenvText([
    'KIE_API_KEY=unit-test-kie-credential',
    'MEIAO_COS_SECRET_ID=unit-test-cos-id',
    'MEIAO_COS_SECRET_KEY=unit-test-cos-key',
  ].join('\n'));
  assert.deepEqual(validateFriendSecretEntries(entries), { ok: true, keys: [
    'KIE_API_KEY', 'MEIAO_COS_SECRET_ID', 'MEIAO_COS_SECRET_KEY',
  ] });
  assert.doesNotMatch(serializeDotenv(entries), /undefined|null/);
});

test('friend bundle rejects production infrastructure and unknown keys', () => {
  for (const key of ['MEIAO_DB_PASSWORD', 'MEIAO_ADMIN_PASSWORD', 'SSH_PRIVATE_KEY', 'UNKNOWN_TOKEN']) {
    const result = validateFriendSecretEntries(new Map([[key, 'unit-test-sensitive-value']]));
    assert.equal(result.ok, false);
    assert.deepEqual(result.rejectedKeys, [key, '__bundle__'].sort());
    assert.equal(result.reasons.__bundle__, 'provider_credential_required');
  }
});

test('friend bundle requires at least one provider credential', () => {
  const result = validateFriendSecretEntries(new Map([
    ['MEIAO_COS_BUCKET', 'unit-test-bucket'],
    ['MEIAO_COS_REGION', 'ap-guangzhou'],
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.reasons.__bundle__, 'provider_credential_required');
});

test('friend bundle rejects visibly truncated sensitive values', () => {
  const result = validateFriendSecretEntries(new Map([['KIE_API_KEY', 'short']]));
  assert.equal(result.ok, false);
  assert.equal(result.reasons.KIE_API_KEY, 'truncated_sensitive_value');
});

test('dotenv parsing rejects conflicting duplicate keys and multiline values', () => {
  assert.throws(() => parseDotenvText('KIE_API_KEY=unit-test-a\nKIE_API_KEY=unit-test-b'));
  assert.throws(() => parseDotenvText('KIE_API_KEY="line1\nline2"'));
});
```

- [ ] **Step 2: Run the policy test and confirm RED**

Run: `node --test scripts/secret-bundle-policy.test.mjs`

Expected: FAIL because `scripts/secret-bundle-policy.mjs` does not exist.

- [ ] **Step 3: Implement the policy module**

Define an exact allowlist containing the variable families approved in the design. Parsing supports comments, `export KEY=VALUE`, single/double quoted values, CRLF, and the first `=` as separator. It rejects malformed names, duplicate keys with different values, multiline values, NUL bytes, empty sensitive values, placeholder values, forbidden keys, and unknown keys. Serialization sorts keys and uses JSON-compatible double quoting only when a value cannot be emitted safely as a plain dotenv scalar. The validator also requires at least one of `KIE_API_KEY`, `MEIAO_KIE_API_KEY`, `APIPORTS_API_KEY`, `MEIAO_APIPORTS_API_KEY`, `MAXFORAI_API_KEY`, `MAXFORAI_VIDEO_API_KEY`, `OPENAI_COMPATIBLE_API_KEY`, `ARK_API_KEY`, `MEIAO_SPIDER_API_KEY`, or `GOLDEN_SUBTITLE_API_TOKEN`.

```js
export const FRIEND_SECRET_ALLOWLIST = new Set([
  'KIE_API_KEY', 'MEIAO_KIE_API_KEY', 'KIE_CHAT_MODEL',
  'APIPORTS_API_KEY', 'MEIAO_APIPORTS_API_KEY', 'APIPORTS_BASE_URL',
  'MAXFORAI_API_KEY', 'MAXFORAI_BASE_URL',
  'MAXFORAI_VIDEO_API_KEY', 'MAXFORAI_VIDEO_BASE_URL',
  'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODELS',
  'ARK_API_KEY', 'MEIAO_SPIDER_API_KEY', 'MEIAO_SPIDER_GATEWAY_URL',
  'GOLDEN_SUBTITLE_API_TOKEN', 'MEIAO_SUBTITLE_REMOVAL_BASE_URL',
  'MEIAO_COS_SECRET_ID', 'MEIAO_COS_SECRET_KEY', 'MEIAO_COS_BUCKET', 'MEIAO_COS_REGION',
  'MEIAO_IMAGE_COS_SECRET_ID', 'MEIAO_IMAGE_COS_SECRET_KEY',
  'MEIAO_IMAGE_COS_BUCKET', 'MEIAO_IMAGE_COS_REGION',
]);

export const FRIEND_SECRET_FORBIDDEN = new Set([
  'DATABASE_URL', 'MEIAO_DB_HOST', 'MEIAO_DB_PORT', 'MEIAO_DB_NAME',
  'MEIAO_DB_USER', 'MEIAO_DB_PASSWORD', 'MEIAO_ADMIN_USERNAME',
  'MEIAO_ADMIN_PASSWORD', 'MEIAO_SUPER_ADMIN_USERS', 'SESSION_SECRET',
  'MEIAO_MANAGED_ASSET_ACCESS_SECRET', 'MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET',
  'SSH_PRIVATE_KEY', 'GITHUB_TOKEN',
]);

const PROVIDER_KEYS = new Set([
  'KIE_API_KEY', 'MEIAO_KIE_API_KEY', 'APIPORTS_API_KEY',
  'MEIAO_APIPORTS_API_KEY', 'MAXFORAI_API_KEY', 'MAXFORAI_VIDEO_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY', 'ARK_API_KEY', 'MEIAO_SPIDER_API_KEY',
  'GOLDEN_SUBTITLE_API_TOKEN',
]);

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const PLACEHOLDER_RE = /^(?:<[^>]+>|sk-?x{4,}|change[_-]?me.*|your[_-].*|example.*)$/i;

function decodeValue(raw, lineNumber) {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new Error(`dotenv_unclosed_quote:${lineNumber}`);
    const decoded = JSON.parse(value);
    if (decoded.includes('\n') || decoded.includes('\r')) {
      throw new Error(`dotenv_multiline_value:${lineNumber}`);
    }
    return decoded;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`dotenv_unclosed_quote:${lineNumber}`);
    const decoded = value.slice(1, -1);
    if (decoded.includes('\n') || decoded.includes('\r')) {
      throw new Error(`dotenv_multiline_value:${lineNumber}`);
    }
    return decoded;
  }
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`dotenv_multiline_value:${lineNumber}`);
  }
  return value;
}

export function parseDotenvText(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new Error('dotenv_invalid_input');
  const entries = new Map();
  for (const [index, rawLine] of text.replaceAll('\r\n', '\n').split('\n').entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`dotenv_invalid_line:${index + 1}`);
    const key = line.slice(0, separator).trim();
    if (!KEY_RE.test(key)) throw new Error(`dotenv_invalid_key:${index + 1}`);
    const value = decodeValue(line.slice(separator + 1), index + 1);
    if (entries.has(key) && entries.get(key) !== value) {
      throw new Error(`dotenv_conflicting_duplicate:${key}`);
    }
    entries.set(key, value);
  }
  return entries;
}

export function validateFriendSecretEntries(entries) {
  const reasons = {};
  for (const [key, value] of entries) {
    if (FRIEND_SECRET_FORBIDDEN.has(key)) reasons[key] = 'forbidden_key';
    else if (!FRIEND_SECRET_ALLOWLIST.has(key)) reasons[key] = 'unknown_key';
    else if (!String(value).trim()) reasons[key] = 'empty_value';
    else if (PLACEHOLDER_RE.test(String(value).trim())) reasons[key] = 'placeholder_value';
    else if (/(?:API_KEY|TOKEN|SECRET_ID|SECRET_KEY)$/.test(key) && String(value).trim().length < 12) {
      reasons[key] = 'truncated_sensitive_value';
    }
  }
  if (![...entries.keys()].some((key) => PROVIDER_KEYS.has(key))) {
    reasons.__bundle__ = 'provider_credential_required';
  }
  const rejectedKeys = Object.keys(reasons).sort();
  return rejectedKeys.length
    ? { ok: false, rejectedKeys, reasons }
    : { ok: true, keys: [...entries.keys()].sort() };
}

export function serializeDotenv(entries) {
  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const text = String(value);
      const encoded = /^[A-Za-z0-9_./:@+,-]+$/.test(text) ? text : JSON.stringify(text);
      return `${key}=${encoded}`;
    })
    .join('\n') + '\n';
}
```

- [ ] **Step 4: Run the policy tests and confirm GREEN**

Run: `node --test scripts/secret-bundle-policy.test.mjs`

Expected: PASS with no secret values in output.

- [ ] **Step 5: Commit the policy module**

```bash
git add scripts/secret-bundle-policy.mjs scripts/secret-bundle-policy.test.mjs
git commit -m "feat(security): define friend secret policy"
```

### Task 2: Add secret export and one-command atomic import

**Files:**
- Create: `scripts/export-friend-secret-bundle.mjs`
- Create: `scripts/import-secret-bundle.mjs`
- Create: `scripts/secret-bundle-file-ops.mjs`
- Create: `scripts/secret-bundle-file-ops.test.mjs`
- Create: `scripts/secret-bundle-cli.test.mjs`
- Modify: `server/envLoader.mjs`
- Modify: `server/envLoader.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: policy exports from Task 1.
- Produces: `npm run secrets:export -- --source /www/wwwroot/meiao-internal/.env.server --output /tmp/.env.meiao.friend` and `npm run secrets:import -- /Users/friend/Downloads/.env.meiao.friend [--force]`.

- [ ] **Step 1: Write failing CLI tests**

Use this test harness and assertions; all values are synthetic and deliberately unusable:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const exporter = path.join(projectRoot, 'scripts/export-friend-secret-bundle.mjs');
const importer = path.join(projectRoot, 'scripts/import-secret-bundle.mjs');

function run(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
}

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-cli-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  await writeFile(path.join(root, '.env.server.example'), 'APP_PORT=3100\n', 'utf8');
  return root;
}

test('export writes only allowlisted non-empty keys with mode 0600', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-export-'));
  const source = path.join(outside, 'source.env');
  const output = path.join(outside, '.env.meiao.friend');
  await writeFile(source, [
    'KIE_API_KEY=fixture-provider-credential-a1',
    'MEIAO_DB_PASSWORD=fixture-db-password-a1',
    'MEIAO_ADMIN_PASSWORD=fixture-admin-password-a1',
  ].join('\n'));
  const result = run(exporter, ['--source', source, '--output', output], repo);
  assert.equal(result.status, 0, result.stderr);
  const exported = await readFile(output, 'utf8');
  assert.match(exported, /^KIE_API_KEY=/m);
  assert.doesNotMatch(exported, /MEIAO_DB_PASSWORD|MEIAO_ADMIN_PASSWORD/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  for (const value of ['fixture-provider-credential-a1', 'fixture-db-password-a1', 'fixture-admin-password-a1']) {
    assert.equal((result.stdout + result.stderr).includes(value), false);
  }
});

test('export rejects unknown or duplicate argv and never replaces an existing output', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-export-contract-'));
  const source = path.join(outside, 'source.env');
  const output = path.join(outside, '.env.meiao.friend');
  await writeFile(source, 'KIE_API_KEY=fixture-provider-argv-a2\n');
  await writeFile(output, 'existing-output\n', { mode: 0o600 });
  for (const args of [
    ['--source', source, '--output', output, '--api-key', 'fixture-argv-secret-a2'],
    ['--source', source, '--source', source, '--output', output],
    ['--source', source, '--output', output],
  ]) {
    const result = run(exporter, args, repo);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(output, 'utf8'), 'existing-output\n');
    assert.equal((result.stdout + result.stderr).includes('fixture-argv-secret-a2'), false);
  }
});

test('import refuses a bundle inside the repository unless git says it is ignored', async () => {
  const repo = await makeRepo();
  const bundle = path.join(repo, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-credential-b2\n');
  const result = run(importer, [bundle], repo);
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(repo, '.env.server')));
});

test('import backs up and atomically merges an external bundle without printing values', async () => {
  const repo = await makeRepo();
  const original = 'APP_PORT=3100\nLOCAL_ONLY=1\n';
  await writeFile(path.join(repo, '.env.server'), original, { mode: 0o600 });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-import-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-credential-c3\n');
  const result = run(importer, [bundle], repo);
  assert.equal(result.status, 0, result.stderr);
  const merged = await readFile(path.join(repo, '.env.server'), 'utf8');
  assert.match(merged, /^APP_PORT=3100$/m);
  assert.match(merged, /^LOCAL_ONLY=1$/m);
  assert.match(merged, /^KIE_API_KEY=/m);
  assert.equal((await stat(path.join(repo, '.env.server'))).mode & 0o777, 0o600);
  const files = await readdir(repo);
  assert.equal(files.filter((name) => name.startsWith('.env.server.backup-')).length, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-provider-credential-c3/);
});

test('import preserves an existing non-empty provider key unless --force is present', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, '.env.server'), 'KIE_API_KEY=fixture-existing-d4\n', { mode: 0o600 });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-force-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-replacement-e5\n');
  assert.equal(run(importer, [bundle], repo).status, 0);
  assert.match(await readFile(path.join(repo, '.env.server'), 'utf8'), /fixture-existing-d4/);
  assert.equal(run(importer, [bundle, '--force'], repo).status, 0);
  assert.match(await readFile(path.join(repo, '.env.server'), 'utf8'), /fixture-replacement-e5/);
});

test('import rejects forbidden or unknown keys without partial writes', async () => {
  const repo = await makeRepo();
  const original = 'APP_PORT=3100\n';
  await writeFile(path.join(repo, '.env.server'), original, { mode: 0o600 });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-reject-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-f6\nMEIAO_DB_PASSWORD=fixture-db-f6\n');
  const result = run(importer, [bundle], repo);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(path.join(repo, '.env.server'), 'utf8'), original);
  assert.equal((result.stdout + result.stderr).includes('fixture-provider-f6'), false);
  assert.equal((result.stdout + result.stderr).includes('fixture-db-f6'), false);
  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-f7\nUNKNOWN_TOKEN=fixture-unknown-f7\n');
  const unknownResult = run(importer, [bundle], repo);
  assert.notEqual(unknownResult.status, 0);
  assert.equal(await readFile(path.join(repo, '.env.server'), 'utf8'), original);
  assert.equal((unknownResult.stdout + unknownResult.stderr).includes('fixture-unknown-f7'), false);
});

test('import rejects symlink targets and an existing cooperative lock without mutation', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-symlink-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-symlink-g7\n');
  // Create a real outside target plus `.env.server` symlink; assert both stay byte-identical.
  // Replace the symlink with a regular file plus `.env.server.import.lock`; assert both stay unchanged.
});

test('imported quoted values round-trip through the application env loader', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-roundtrip-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  const expected = 'fixture provider credential with space # and "quote"';
  await writeFile(bundle, `KIE_API_KEY=${JSON.stringify(expected)}\n`);
  const result = run(importer, [bundle], repo);
  assert.equal(result.status, 0, result.stderr);
  const { loadServerEnvFile } = await import('../server/envLoader.mjs');
  const targetEnv = {};
  loadServerEnvFile({ envPath: path.join(repo, '.env.server'), targetEnv });
  assert.equal(targetEnv.KIE_API_KEY, expected);
});
```

- [ ] **Step 2: Run CLI tests and confirm RED**

Run: `node --test scripts/secret-bundle-cli.test.mjs`

Expected: FAIL because both CLI files are missing.

- [ ] **Step 3: Implement the exporter**

The exporter requires exactly one `--source ABSOLUTE_PATH` pair and one `--output ABSOLUTE_PATH` pair, rejects unknown/duplicate/missing flags before reading files, resolves the output parent with `realpath`, refuses output inside the Git worktree, reads only allowlisted non-empty values, validates them, writes through a sibling temporary file with mode `0600`, installs the final name atomically without replacing an existing path, and prints only JSON `{ outputPath, exportedKeys, omittedKeys, cosRisk: boolean }`. It accepts no secret via argv, stdin, or environment-variable overrides; `--source` equal to `--output` fails without mutation.

Implement this control flow in `scripts/export-friend-secret-bundle.mjs`:

```js
import { chmod, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FRIEND_SECRET_ALLOWLIST,
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';
import { installFileNoReplace } from './secret-bundle-file-ops.mjs';

const rawArgs = process.argv.slice(2);
if (rawArgs.length !== 4) throw new Error('usage: secrets:export -- --source ABSOLUTE_PATH --output ABSOLUTE_PATH');
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
try {
  await writeFile(temporary, serializeDotenv(selected), { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600);
  await installFileNoReplace(temporary, canonicalOutput);
} catch (error) {
  await unlink(temporary).catch(() => {});
  throw error;
}
console.log(JSON.stringify({
  outputPath: canonicalOutput,
  exportedKeys: validation.keys,
  omittedKeys: [...FRIEND_SECRET_ALLOWLIST].filter((key) => !selected.has(key)).sort(),
  cosRisk: validation.keys.some((key) => key.includes('_COS_')),
}));
```

- [ ] **Step 4: Implement reusable file-safety operations and focused tests**

In `scripts/secret-bundle-file-ops.mjs`, implement `acquireExclusiveLock(lockPath)`, `readRegularFileSnapshot(targetPath)`, `assertFileSnapshotUnchanged(targetPath, snapshot)`, `writeExclusive0600(path, text)`, and `installFileNoReplace(temporaryPath, finalPath)`. Use `lstat({ bigint: true })`, reject non-regular files, compare device/inode/size/nanosecond mtime plus byte content, create via `open(path, 'wx', 0o600)`, `FileHandle.writeFile`, `FileHandle.sync`, and close-before-return. `installFileNoReplace` uses `link` followed by `unlink`, so the final name cannot replace anything. Tests cover symlink rejection, content drift, inode replacement with equal content, existing-final no-replace, backup mode `0600`, and release of only the acquired lock.

- [ ] **Step 5: Implement the importer**

The importer resolves the repository using `git rev-parse --show-toplevel`, canonicalizes the existing bundle with `realpath`, and runs `git check-ignore --quiet --` with the computed repository-relative bundle path only when the bundle is inside the repository. It acquires `.env.server.import.lock` by exclusive `0600` creation before inspecting the target. A current `.env.server` must be a regular non-symlink file; record its device, inode, size, nanosecond mtime, and bytes, then re-check all of them immediately before commit. It parses `.env.server.example`, the current snapshot, and the bundle; validates the entire bundle before backup/write; preserves existing non-empty allowlisted values unless `--force` is present; writes `.env.server.backup-YYYYMMDDTHHMMSS` from the already-read bytes through an exclusive `0600` file handle; writes a `0600` temporary file; and reports imported key names and missing capabilities without values. For an initially absent target, install without replacement; for an existing target, rename only after the cooperative lock and unchanged-snapshot check. Any parse, validation, lock, snapshot, backup, chmod, write, or install failure leaves the original `.env.server` byte-identical. Always release only the lock created by the current process.

Implement the commit sequence in `scripts/import-secret-bundle.mjs` exactly in this order:

```js
const lock = await acquireExclusiveLock(`${targetPath}.import.lock`);
let temporaryCreated = false;
try {
  const snapshot = await readRegularFileSnapshot(targetPath);
  const current = snapshot.exists ? parseDotenvText(snapshot.text) : new Map();
  // Parse and validate the example plus the complete incoming bundle here.
  // Compute merged/imported/preserved only from this locked snapshot.
  if (snapshot.exists) await writeExclusive0600(backupPath, snapshot.text);
  await writeExclusive0600(temporary, serializeDotenv(merged));
  temporaryCreated = true;
  await assertFileSnapshotUnchanged(targetPath, snapshot);
  if (snapshot.exists) await rename(temporary, targetPath);
  else await installFileNoReplace(temporary, targetPath);
  temporaryCreated = false;
} finally {
  if (temporaryCreated) await unlink(temporary).catch(() => {});
  await lock.release();
}
```

The omitted parse/merge section is the already-tested Task 2 logic: validate the complete incoming map before `writeExclusive0600`, keep existing non-empty allowlisted values unless `--force`, and report only key names/booleans/`npm run doctor` after successful commit.

- [ ] **Step 6: Make the runtime env loader decode serialized quoted values**

Update `stripWrappingQuotes` in `server/envLoader.mjs` so a double-quoted value first attempts `JSON.parse(value)` and accepts the result only when it is a string. Preserve the existing slice behavior for single quotes and for legacy double-quoted strings that are not valid JSON. Add a focused `server/envLoader.test.mjs` case for spaces, `#`, escaped quote, and escaped backslash so the importer and application share one round-trip contract.

- [ ] **Step 7: Wire npm scripts and ignore rules**

```json
{
  "scripts": {
    "secrets:export": "node scripts/export-friend-secret-bundle.mjs",
    "secrets:import": "node scripts/import-secret-bundle.mjs"
  }
}
```

Add explicit ignores for `.env.meiao.friend`, `.env.server.backup-*`, `.env.server.tmp-*`, and `.env.server.import.lock` even though `.env.*` already provides defense in depth.

- [ ] **Step 8: Run CLI, file-safety, policy, and runtime env-loader tests**

Run: `node --test scripts/secret-bundle-policy.test.mjs scripts/secret-bundle-file-ops.test.mjs scripts/secret-bundle-cli.test.mjs server/envLoader.test.mjs`

Expected: PASS; test output contains no fixture secret values.

- [ ] **Step 9: Commit importer/exporter**

```bash
git add .gitignore package.json server/envLoader.mjs server/envLoader.test.mjs scripts/export-friend-secret-bundle.mjs scripts/import-secret-bundle.mjs scripts/secret-bundle-file-ops.mjs scripts/secret-bundle-file-ops.test.mjs scripts/secret-bundle-cli.test.mjs
git commit -m "feat(security): add one-command secret import"
```

### Task 3: Add tracked-file secret scanning to the release gate

**Files:**
- Create: `scripts/check-tracked-secrets.mjs`
- Create: `scripts/check-tracked-secrets.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `git ls-files -z` and tracked file bytes; optional `--root /absolute/repository/path` exists for isolated tests.
- Produces: `npm run security:secrets`; exit 0 for clean, exit 1 with redacted location metadata for findings.

- [ ] **Step 1: Write failing scanner tests**

Create temporary Git repositories with the following exact tests. Token-shaped values are assembled at runtime so the test source itself does not contain a live-looking literal.

```js
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scanner = path.resolve(import.meta.dirname, 'check-tracked-secrets.mjs');

async function repository(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-scan-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(root, name);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(target), { recursive: true }));
    await writeFile(target, value);
  }
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  return root;
}

function scan(root) {
  return spawnSync(process.execPath, [scanner, '--root', root], { encoding: 'utf8' });
}

test('scanner reports supported credential rules without exposing values', async () => {
  const values = {
    'pem.txt': '-----BEGIN ' + 'PRIVATE KEY-----',
    'aws.txt': 'AKIA' + 'A'.repeat(16),
    'tencent.txt': 'AKID' + 'B'.repeat(32),
    'google.txt': 'AIza' + 'C'.repeat(35),
    'github.txt': 'ghp_' + 'D'.repeat(36),
    'slack.txt': 'xoxb-' + '1'.repeat(12) + '-' + 'E'.repeat(24),
    'provider.txt': 'sk-' + 'F'.repeat(40),
    'url.txt': ['mysql://fixture-user', 'fixture-password@db.invalid/app'].join(':'),
    'assignment.txt': 'apiKey = "' + 'G7h8J9k0Lm1N2p3Q4r5S6t7U8v9W0xY1' + '"',
    'dotenv.txt': 'SOME_SECRET=' + 'H8i9J0k1Lm2N3p4Q5r6S7t8U9v0W1xY2',
  };
  const result = scan(await repository(values));
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.length, Object.keys(values).length);
  for (const finding of report.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['file', 'length', 'line', 'rule']);
  }
  for (const value of Object.values(values)) {
    assert.equal(result.stdout.includes(value), false);
    assert.equal(result.stderr.includes(value), false);
  }
});

test('scanner rejects unknown CLI arguments before reading the repository', async () => {
  const result = spawnSync(process.execPath, [scanner, '--root', '/does/not/exist', '--token', 'fixture-argv-secret'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal((result.stdout + result.stderr).includes('fixture-argv-secret'), false);
});

test('scanner refuses a repository subdirectory as --root', async () => {
  const root = await repository({
    'outside.txt': 'sk-' + 'R'.repeat(40),
    'nested/ordinary.txt': 'ordinary text',
  });
  const result = scan(path.join(root, 'nested'));
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('scanner covers JS and JSON quoted literals but skips dynamic member expressions', async () => {
  const staticValue = 'J8k9L0m1N2p3Q4r5S6t7U8v9W0xY1zA2';
  const root = await repository({
    'config.mjs': `const x = {\n  apiKey: ${JSON.stringify(staticValue)},\n  dynamicToken: process.env.RUNTIME_TOKEN,\n};`,
    'config.json': JSON.stringify({ password: staticValue }, null, 2),
  });
  const result = scan(root);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).findings.length, 2);
});

test('scanner never emits a matched value embedded in its tracked filename', async () => {
  const value = 'sk-' + 'P'.repeat(40);
  const root = await repository({ [`prefix-${value}.txt`]: value });
  const result = scan(root);
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(value), false);
});

test('scanner accepts only the exact synthetic fixtures and placeholders', async () => {
  const root = await repository({
    'fixtures/allowed-secrets.txt': [
      'OPENAI_COMPATIBLE_API_KEY=sk-test',
      'OPENAI_COMPATIBLE_API_KEY=sk-xxxx',
      'OPENAI_COMPATIBLE_API_KEY=unit-test-provider-credential',
    ].join('\n'),
  });
  const result = scan(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { findings: [] });
});
```

- [ ] **Step 2: Run scanner tests and confirm RED**

Run: `node --test scripts/check-tracked-secrets.test.mjs`

Expected: FAIL because the scanner does not exist.

- [ ] **Step 3: Implement the scanner**

Parse argv strictly as either no arguments or exactly `--root ABSOLUTE_PATH`, rejecting unknown/duplicate/missing flags without echoing values. Resolve `git rev-parse --show-toplevel` and require the requested/root cwd canonical path to equal that top-level path; a subdirectory is an error, never a partial scan. Read tracked paths via `git ls-files -z`; for each path use `lstat`, read regular-file worktree bytes, read a symlink's link text without following it outside the repository, and reject unsupported file types. Compare device, inode, size, nanosecond mtime, and nanosecond ctime before/after every regular-file and symlink read. Skip NUL-containing binary blobs. Use exact regex rules plus Shannon entropy for quoted and unquoted sensitive assignments across dotenv, YAML, JS/TS, and JSON, accepting ordinary trailing comma/semicolon syntax while excluding unquoted identifier/member-expression references such as `process.env.RUNTIME_TOKEN`. Never include the matched value or a value-derived hash in output; if a tracked filename contains the same matched value, replace that substring with `[redacted]` before storing the finding. Test exceptions require an exact relative path and exact clearly synthetic value; no directory-wide exclusions.

Implement the scanner with this structure:

```js
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
if (!(rawArgs.length === 0 || (rawArgs.length === 2 && rawArgs[0] === '--root' && path.isAbsolute(rawArgs[1])))) {
  throw new Error('usage: check-tracked-secrets [--root ABSOLUTE_PATH]');
}
const root = await realpath(rawArgs.length ? rawArgs[1] : process.cwd());
const topLevelResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
if (topLevelResult.status !== 0 || await realpath(topLevelResult.stdout.trim()) !== root) {
  throw new Error('repository_root_required');
}
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root });
if (tracked.status !== 0) throw new Error('git_ls_files_failed');

const exactSyntheticAllowlist = new Map([
  ['fixtures/allowed-secrets.txt', new Set([
    'sk-test', 'sk-xxxx', 'unit-test-provider-credential',
  ])],
]);
const rules = [
  ['pem_private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['tencent_secret_id', /\bAKID[A-Za-z0-9]{32}\b/g],
  ['google_api_key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['provider_token', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['credential_url', /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g],
];
const assignment = /^\s*(?:-\s+)?(?:export\s+)?(["']?)(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*|api[_-]?key|secret|token|password)\1\s*[:=]\s*(?:["']([^"'\r\n]{20,})["']|([^\s#,"']{20,}))(?:\s+#.*)?\s*[,;]?\s*$/gi;

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

const findings = [];
for (const file of tracked.stdout.toString('utf8').split('\0').filter(Boolean)) {
  const absolute = path.join(root, file);
  const stats = await lstat(absolute);
  const bytes = stats.isSymbolicLink()
    ? Buffer.from(await readlink(absolute), 'utf8')
    : stats.isFile()
      ? await readFile(absolute)
      : (() => { throw new Error(`unsupported_tracked_file_type:${file}`); })();
  if (bytes.includes(0)) continue;
  for (const [lineIndex, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
    for (const [rule, pattern] of rules) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        if (exactSyntheticAllowlist.get(file)?.has(match[0])) continue;
        const safeFile = file.includes(match[0]) ? file.split(match[0]).join('[redacted]') : file;
        findings.push({ file: safeFile, line: lineIndex + 1, rule, length: match[0].length });
      }
    }
    assignment.lastIndex = 0;
    for (const match of line.matchAll(assignment)) {
      const value = match[1] || match[2];
      if (exactSyntheticAllowlist.get(file)?.has(value)) continue;
      if (new Set(value).size >= 10 && entropy(value) >= 3.5) {
        findings.push({ file, line: lineIndex + 1, rule: 'high_entropy_assignment', length: value.length });
      }
    }
  }
}
findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule));
console.log(JSON.stringify({ findings }));
if (findings.length) process.exitCode = 1;
```

- [ ] **Step 4: Add the standalone scanner command**

```json
{
  "scripts": {
    "security:secrets": "node scripts/check-tracked-secrets.mjs"
  }
}
```

- [ ] **Step 5: Run scanner tests and the current-tree scan**

Run: `node --test scripts/check-tracked-secrets.test.mjs && npm run security:secrets`

Expected before Task 4 sanitization: scanner reports the confirmed design-document credential without revealing its value. This is the intended RED integration state.

- [ ] **Step 6: Commit the scanner while leaving the existing verify chain unchanged**

```bash
git add package.json scripts/check-tracked-secrets.mjs scripts/check-tracked-secrets.test.mjs
git commit -m "test(security): gate tracked secrets"
```

The scanner itself and its unit tests are green. The standalone repository scan intentionally reports the already-known credential until Task 4 removes it; `npm run verify` is not wired to the scanner until that removal is complete.

### Task 4: Sanitize the current tree and publish friend setup instructions

**Files:**
- Modify: `docs/superpowers/specs/2026-06-16-生图工具调用-design.md`
- Create: `docs/friend-secret-setup.md`
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/agents/repeated-issues.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: import/export commands from Task 2 and scanner from Task 3.
- Produces: a clean current tree and an AI-readable installation contract.

- [ ] **Step 1: Replace the live value in the current document**

Replace the assignment value with the literal placeholder `sk-xxxx`. Do not copy the original value into a patch, commit message, terminal output, or root-cause document.

- [ ] **Step 2: Write the friend setup document**

Document these exact commands:

```bash
git clone https://github.com/gearaldblynn-lang/Meiao.git
cd Meiao
npm ci
npm run secrets:import -- /absolute/path/.env.meiao.friend
npm run doctor
```

Explain that the bundle stays outside the repo, that provider/COS keys may incur charges or access shared storage, and that MySQL/Temporal/FFmpeg remain separate local prerequisites.

- [ ] **Step 3: Synchronize templates and root-cause guidance**

Add comments to `.env.server.example` and `docs/project-overview.md` pointing to `docs/friend-secret-setup.md`. Record the root cause in `docs/agents/repeated-issues.md`: a design document contained a live credential, Git was public, current-tree `.gitignore` did not protect literals pasted into tracked Markdown, and prevention is the tracked-file scanner plus external bundle importer.

- [ ] **Step 4: Run the security and CLI gates**

Prefix the repository's current exact `verify` chain so it becomes `npm run security:secrets && npm run lint && npm test && npm run build`, then run:

Run: `npm run security:secrets && node --test scripts/secret-bundle-policy.test.mjs scripts/secret-bundle-cli.test.mjs scripts/check-tracked-secrets.test.mjs`

Expected: PASS with zero live-secret findings.

- [ ] **Step 5: Commit current-tree sanitization**

```bash
git add .env.server.example package.json docs/friend-secret-setup.md docs/project-overview.md docs/agents/repeated-issues.md docs/superpowers/specs/2026-06-16-生图工具调用-design.md
git commit -m "fix(security): remove tracked provider credential"
```

### Task 5: Rotate the exposed provider key and generate the private friend bundle

**Files:**
- Cloud mutation: `/www/wwwroot/meiao-internal/.env.server`
- Create outside Git: `/Users/feiyanglin/.meiao-security/retired-openai-compatible.fingerprint`
- Create outside Git: `/Users/feiyanglin/Desktop/.env.meiao.friend`

**Interfaces:**
- Consumes: provider console access, Task 2 exporter, Tencent SSH access.
- Produces: revoked old key, healthy cloud using a new key, and a `0600` external bundle.

- [ ] **Step 1: Confirm zero active jobs before cloud mutation**

Run the existing deploy-readiness check against cloud:

```bash
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 \
  'cd /www/wwwroot/meiao-internal && set -a && . ./.env.server && set +a && node scripts/check-deploy-readiness.mjs'
```

Expected: `runningCount=0`, `providerlessCount=0`, `submittedCount=0`.

- [ ] **Step 2: Create a new OpenAI-compatible provider key**

Use the authenticated provider console selected by the current `OPENAI_COMPATIBLE_BASE_URL`. Store the new value only in the console and the remote environment editor; never place it in a tool message or shell argument. If the console cannot prove create/revoke ownership, stop before bundle generation and history force-push.

- [ ] **Step 3: Preserve only the retired-key fingerprint outside Git**

Before replacing the cloud value, create the digest file without terminal output. The Node process reads the key from the already-loaded environment, writes only the SHA-256 digest to a root-only server file, and the file is copied to a local `0700` directory with mode `0600`:

```bash
mkdir -p -m 700 /Users/feiyanglin/.meiao-security
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 \
  'cd /www/wwwroot/meiao-internal && set -a && . ./.env.server && set +a && umask 077 && node --input-type=module -e '\''import { createHash } from "node:crypto"; import { writeFileSync } from "node:fs"; const value=process.env.OPENAI_COMPATIBLE_API_KEY||""; if(!value) process.exit(2); writeFileSync("/root/retired-openai-compatible.fingerprint",createHash("sha256").update(value).digest("hex"),{mode:0o600});'\'''
scp -q -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" \
  root@111.229.66.247:/root/retired-openai-compatible.fingerprint \
  /Users/feiyanglin/.meiao-security/retired-openai-compatible.fingerprint
chmod 600 /Users/feiyanglin/.meiao-security/retired-openai-compatible.fingerprint
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 \
  'rm -f /root/retired-openai-compatible.fingerprint'
```

Verify only that the local file has exactly 64 hexadecimal bytes and mode `0600`; do not print its content.

- [ ] **Step 4: Back up and atomically update cloud env**

Create `/root/meiao-env-before-openai-rotation-20260722` with mode `0600`, update only `OPENAI_COMPATIBLE_API_KEY` through a no-echo interactive editor, source `.env.server`, and restart PM2 with `--update-env`. Before restart, parse the before/after files and assert that the changed-key set is exactly `['OPENAI_COMPATIBLE_API_KEY']`; report only that key name. Verify the restarted process has the same new value as `.env.server` using an in-process boolean comparison; do not print the key or its hash.

- [ ] **Step 5: Verify new-key health without paid creation**

Run `/api/health`, worker health, the model-provider connection test, and a provider authentication/readiness request that cannot create a paid generation. Expected: service online, worker healthy, provider configured and authenticated.

- [ ] **Step 6: Revoke the old provider key**

Revoke the exposed key in the provider console. On the server, source `/root/meiao-env-before-openai-rotation-20260722` only inside a one-shot Node process and issue the same non-paid authentication request; assert only that the response is `401` or `403`, with response body suppressed. Then delete that retired-key backup. If rejection cannot be proven, stop before exporting the friend bundle or rewriting Git history.

- [ ] **Step 7: Export the allowlisted friend bundle**

Copy only `scripts/secret-bundle-policy.mjs` and `scripts/export-friend-secret-bundle.mjs` to a new root-owned `0700` temporary directory on the server. Run the exporter there with source `/www/wwwroot/meiao-internal/.env.server` and output inside that temporary directory, SCP the result to `/Users/feiyanglin/Desktop/.env.meiao.friend`, set local mode `0600`, then delete the remote temporary directory. Inspect only the key-name manifest and assert all forbidden keys are absent. Do not deploy or restart the application merely to run the exporter.

- [ ] **Step 8: Verify the bundle with a disposable clone**

Import it into a temporary clone and assert `.env.server` mode `0600`, expected allowlisted key names present, forbidden names absent, output redacted, and original bundle still outside Git.

### Task 6: Rewrite all Git history and force-update remote refs

**Files:**
- Temporary mirror: `/tmp/meiao-git-sanitize-20260722/Meiao.git`
- No secret-bearing backup bundle is created.

**Interfaces:**
- Consumes: sanitized commits from Tasks 1-4 plus `/Users/feiyanglin/.meiao-security/retired-openai-compatible.fingerprint` from Task 5.
- Produces: rewritten branches/tags with zero fingerprint matches.

- [ ] **Step 1: Push the sanitized implementation branch only**

Push `feat/stability-phase2` normally so the remote contains the current sanitized tree before history rewriting. Do not update `main` yet.

- [ ] **Step 2: Create an isolated mirror and ephemeral git-filter-repo install**

```bash
SANITIZE_DIR="$(mktemp -d /tmp/meiao-git-sanitize-20260722.XXXXXX)"
chmod 700 "$SANITIZE_DIR"
git clone --mirror https://github.com/gearaldblynn-lang/Meiao.git "$SANITIZE_DIR/Meiao.git"
python3 -m pip install --target "$SANITIZE_DIR/tools" git-filter-repo
```

Verify the mirror has the exact remote branch and tag counts before rewriting.

- [ ] **Step 3: Rewrite matching credentials by fingerprint**

Before rewriting, capture the authenticated remote URL and every `refs/heads/*` and `refs/tags/*` old OID in a `0600` manifest outside the mirror. Run `git_filter_repo.py --force --blob-callback` with a callback that reads the expected digest from the local `0600` fingerprint file, scans `sk-[A-Za-z0-9_-]{20,}` byte sequences, computes SHA-256 in memory, and replaces only the sequence whose digest matches with `sk-xxxx`. The callback and process output never contain the original value or digest. Because `git-filter-repo` removes `origin`, re-add the captured remote URL only after the all-ref scan passes.

- [ ] **Step 4: Scan every rewritten ref**

Use `git rev-list --objects --all` plus `git cat-file --batch` to inspect every blob. Assert the retired credential has zero in-memory fingerprint matches and run the same provider/private-key rules as `security:secrets` across all reachable blobs. Report only finding counts, rule names, paths, and line numbers. Resolve every remaining real finding before any force push.

- [ ] **Step 5: Force-update refs without deleting unrelated refs**

Use a local `push-rewritten-refs.mjs` inside the `0700` sanitation directory; it reads the `0600` manifest path from `MEIAO_REF_MANIFEST`, sorts branch refs before tags, and executes the exact safe lease form without printing OIDs:

```js
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync(process.env.MEIAO_REF_MANIFEST, 'utf8'));
for (const ref of manifest.refs.sort((left, right) => left.name.localeCompare(right.name))) {
  const result = spawnSync('git', [
    'push', 'origin', `${ref.newOid}:${ref.name}`,
    `--force-with-lease=${ref.name}:${ref.oldOid}`,
  ], { cwd: manifest.mirrorPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(JSON.stringify({ ok: false, ref: ref.name, reason: 'lease_or_protection_rejected' }));
    process.exit(result.status || 1);
  }
  console.log(JSON.stringify({ ok: true, ref: ref.name }));
}
```

Never use a leading `+`, `--force`, `git push --mirror`, `--prune`, or a wildcard deletion refspec. Stop immediately if any lease or branch-protection check rejects an update.

- [ ] **Step 6: Realign the local checkout without a destructive worktree reset**

Fetch rewritten refs into an explicit temporary namespace. Inventory every local `refs/heads/*`, `refs/remotes/*`, and `refs/tags/*`; if any local-only ref is absent from the pre-rewrite manifest, stop and request a preservation decision. Because each sanitized old tip tree and rewritten new tip tree is byte-identical, verify all paired tree OIDs, then use `git update-ref` to move every approved local branch, remote-tracking ref, and tag to its rewritten OID. Delete only obsolete remote-tracking refs that correspond to rewritten refs, expire all reflogs, and run `git gc --prune=now` after the worktree is clean and an in-repo all-object fingerprint scan returns zero.

- [ ] **Step 7: Fresh-clone verification**

Clone GitHub into a new directory from `mktemp -d /tmp/meiao-public-verify-20260722.XXXXXX`, confirm default branch `main`, scan all refs, run `npm ci`, `npm run security:secrets`, targeted secret-bundle tests, and `npm run verify`.

### Task 7: Publish, deploy, and close the security incident

**Files:**
- Modify: `docs/agents/repeated-issues.md` only if verification reveals facts not already recorded.
- Update external diagnostics dashboard through its `record-fix` command.

**Interfaces:**
- Consumes: clean rewritten Git refs, rotated cloud key, verified friend bundle.
- Produces: healthy cloud, downloadable clean GitHub default branch, and a closed-loop security record.

- [ ] **Step 1: Deploy the rewritten clean release commit**

Use `scripts/deploy_tencent.sh` with the standard active-job gates. Verify cloud source checksum against the rewritten local commit, public bundle, `/api/health`, PM2 online state, and worker health.

- [ ] **Step 2: Confirm GitHub and cloud version alignment**

Verify `main`, `feat/stability-phase2`, the release tag, local HEAD, and cloud source all identify the rewritten release tree. Record both new commit IDs and the pre-rewrite commit mapping locally without secret values.

- [ ] **Step 3: Register the incident and prevention fingerprint**

Record `security:public_git:live_provider_key` with root cause, rotation evidence, history-scan evidence, importer/scanner tests, clean-clone verification, and the rule that plaintext bundles remain outside Git.

- [ ] **Step 4: Deliver the private bundle and friend command**

Provide a clickable local path to `/Users/feiyanglin/Desktop/.env.meiao.friend`, its mode and included key names, plus the command:

```bash
npm run secrets:import -- /absolute/path/.env.meiao.friend
```

Do not paste the file contents into the response. Warn that provider calls can incur charges and shared COS credentials can access shared storage.

- [ ] **Step 5: Final verification summary**

Report current-tree scan, all-history scan, revoked old key, cloud health, clean-clone tests, Git ref alignment, bundle location, excluded key families, and any local-infrastructure prerequisites the friend must still install.
