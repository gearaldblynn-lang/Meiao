import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
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

function assertValuesNotLeaked(result, values) {
  const output = result.stdout + result.stderr;
  for (const value of values) assert.equal(output.includes(value), false);
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
  assertValuesNotLeaked(result, [
    'fixture-provider-credential-a1',
    'fixture-db-password-a1',
    'fixture-admin-password-a1',
  ]);
});

test('export rejects invalid argv before file reads and never echoes unknown argv values', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-export-argv-'));
  const source = path.join(outside, 'missing-source.env');
  const cases = [
    ['--source', source, '--output', path.join(outside, 'unknown.env'), '--api-key', 'fixture-argv-secret-a2'],
    ['--source', source, '--source', source, '--output', path.join(outside, 'duplicate-source.env')],
    ['--source', source, '--output', path.join(outside, 'duplicate-output-a.env'), '--output', path.join(outside, 'duplicate-output-b.env')],
    ['--source', source],
    ['--output', path.join(outside, 'missing-source-flag.env')],
  ];

  for (const args of cases) {
    const result = run(exporter, args, repo);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /ENOENT/);
    assertValuesNotLeaked(result, ['fixture-argv-secret-a2']);
  }
});

test('export never replaces an existing output', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-export-existing-'));
  const source = path.join(outside, 'source.env');
  const output = path.join(outside, '.env.meiao.friend');
  const sourceValue = 'fixture-provider-existing-output-b2';
  const existing = 'existing-output-must-remain\n';
  await writeFile(source, `KIE_API_KEY=${sourceValue}\n`);
  await writeFile(output, existing, { mode: 0o600 });

  const result = run(exporter, ['--source', source, '--output', output], repo);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(output, 'utf8'), existing);
  assertValuesNotLeaked(result, [sourceValue]);
});

test('export rejects source equal to output without changing it', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-export-same-'));
  const source = path.join(outside, '.env.meiao.friend');
  const providerValue = 'fixture-provider-source-output-c3';
  const forbiddenValue = 'fixture-db-source-output-c3';
  const original = `KIE_API_KEY=${providerValue}\nMEIAO_DB_PASSWORD=${forbiddenValue}\n`;
  await writeFile(source, original, { mode: 0o600 });

  const result = run(exporter, ['--source', source, '--output', source], repo);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(source, 'utf8'), original);
  assertValuesNotLeaked(result, [providerValue, forbiddenValue]);
});

test('import refuses a bundle inside the repository unless git says it is ignored', async () => {
  const repo = await makeRepo();
  const bundle = path.join(repo, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-credential-b2\n');
  const result = run(importer, [bundle], repo);
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(repo, '.env.server')));
  assertValuesNotLeaked(result, ['fixture-provider-credential-b2']);
});

test('import backs up and atomically merges an external bundle without printing values', async () => {
  const repo = await makeRepo();
  const original = Buffer.concat([
    Buffer.from('APP_PORT=3100\nLOCAL_ONLY=1\n# opaque-comment-'),
    Buffer.from([0xff]),
    Buffer.from('\n'),
  ]);
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
  const backups = files.filter((name) => name.startsWith('.env.server.backup-'));
  assert.equal(backups.length, 1);
  const backup = path.join(repo, backups[0]);
  assert.deepEqual(await readFile(backup), original);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assertValuesNotLeaked(result, ['fixture-provider-credential-c3']);
});

test('import preserves an existing non-empty provider key unless --force is present', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, '.env.server'), 'KIE_API_KEY=fixture-existing-d4\n', { mode: 0o600 });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-force-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  await writeFile(bundle, 'KIE_API_KEY=fixture-replacement-e5\n');
  const preserveResult = run(importer, [bundle], repo);
  assert.equal(preserveResult.status, 0);
  assert.match(await readFile(path.join(repo, '.env.server'), 'utf8'), /fixture-existing-d4/);
  assertValuesNotLeaked(preserveResult, ['fixture-existing-d4', 'fixture-replacement-e5']);
  const forceResult = run(importer, [bundle, '--force'], repo);
  assert.equal(forceResult.status, 0);
  assert.match(await readFile(path.join(repo, '.env.server'), 'utf8'), /fixture-replacement-e5/);
  assertValuesNotLeaked(forceResult, ['fixture-existing-d4', 'fixture-replacement-e5']);
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
  assertValuesNotLeaked(result, ['fixture-provider-f6', 'fixture-db-f6']);

  await writeFile(bundle, 'KIE_API_KEY=fixture-provider-f7\nUNKNOWN_TOKEN=fixture-unknown-f7\n');
  const unknownResult = run(importer, [bundle], repo);
  assert.notEqual(unknownResult.status, 0);
  assert.equal(await readFile(path.join(repo, '.env.server'), 'utf8'), original);
  assertValuesNotLeaked(unknownResult, ['fixture-provider-f7', 'fixture-unknown-f7']);
});

test('import rejects invalid argv without reading or echoing unknown values', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-import-argv-'));
  const bundle = path.join(outside, 'missing.env');
  for (const args of [
    [],
    [bundle, '--force', '--force'],
    ['--force', bundle],
    [bundle, '--unknown', 'fixture-import-argv-secret-g8'],
  ]) {
    const result = run(importer, args, repo);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /ENOENT/);
    assertValuesNotLeaked(result, ['fixture-import-argv-secret-g8']);
  }
});

test('import rejects symlink targets and an existing cooperative lock without mutation', async () => {
  const repo = await makeRepo();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-import-safety-'));
  const bundle = path.join(outside, '.env.meiao.friend');
  const incomingValue = 'fixture-provider-symlink-h9';
  await writeFile(bundle, `KIE_API_KEY=${incomingValue}\n`);

  const target = path.join(repo, '.env.server');
  const outsideTarget = path.join(outside, 'outside-target.env');
  const outsideOriginal = 'OUTSIDE_SENTINEL=unchanged\n';
  await writeFile(outsideTarget, outsideOriginal, { mode: 0o600 });
  await symlink(outsideTarget, target);

  const symlinkResult = run(importer, [bundle], repo);
  assert.notEqual(symlinkResult.status, 0);
  assert.equal((await lstat(target)).isSymbolicLink(), true);
  assert.equal(await readFile(outsideTarget, 'utf8'), outsideOriginal);
  assertValuesNotLeaked(symlinkResult, [incomingValue]);

  await unlink(target);
  const targetOriginal = 'APP_PORT=3100\n';
  await writeFile(target, targetOriginal, { mode: 0o600 });
  const lockPath = `${target}.import.lock`;
  const foreignLock = 'foreign-lock-must-remain\n';
  await writeFile(lockPath, foreignLock, { mode: 0o600 });

  const lockResult = run(importer, [bundle], repo);
  assert.notEqual(lockResult.status, 0);
  assert.equal(await readFile(target, 'utf8'), targetOriginal);
  assert.equal(await readFile(lockPath, 'utf8'), foreignLock);
  assertValuesNotLeaked(lockResult, [incomingValue]);
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
  assertValuesNotLeaked(result, [expected]);
});
