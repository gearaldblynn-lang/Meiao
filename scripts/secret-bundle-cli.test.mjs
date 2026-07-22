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
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-.*password/);
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
