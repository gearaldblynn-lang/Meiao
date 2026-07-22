import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  return root;
}

function scan(root, args = []) {
  return spawnSync(process.execPath, [scanner, '--root', root, ...args], { encoding: 'utf8' });
}

function report(result) {
  return JSON.parse(result.stdout);
}

test('scanner reports supported credential rules without exposing values', async (t) => {
  const values = {
    'pem.txt': '-----BEGIN ' + 'PRIVATE KEY-----',
    'aws.txt': 'AKIA' + 'A'.repeat(16),
    'tencent.txt': 'AKID' + 'B'.repeat(32),
    'google.txt': 'AIza' + 'C'.repeat(35),
    'github.txt': 'ghp_' + 'D'.repeat(36),
    'slack.txt': 'xoxb-' + '1'.repeat(12) + '-' + 'E'.repeat(24),
    'provider.txt': 'sk-' + 'F'.repeat(40),
    'provider-assignment.txt': 'API_TOKEN=sk-' + 'I'.repeat(40),
    'url.txt': ['mysql://fixture-user', 'fixture-password@db.invalid/app'].join(':'),
    'assignment.txt': 'apiKey = "' + 'G7h8J9k0Lm1N2p3Q4r5S6t7U8v9W0xY1' + '"',
    'dotenv.txt': 'SOME_SECRET=' + 'H8i9J0k1Lm2N3p4Q5r6S7t8U9v0W1xY2',
  };
  const root = await repository(values);
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = scan(root);
  assert.equal(result.status, 1);
  const findings = report(result).findings;
  assert.equal(findings.length, Object.keys(values).length);
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['file', 'length', 'line', 'rule']);
  }
  for (const value of Object.values(values)) {
    assert.equal(result.stdout.includes(value), false);
    assert.equal(result.stderr.includes(value), false);
  }
});

test('scanner rejects noncanonical CLI arguments before reading the repository', () => {
  for (const args of [
    ['--root', '/does/not/exist', '--token', 'fixture-argv-secret'],
    ['--root'],
    ['--root', 'relative-root'],
    ['--root', '/does/not/exist', '--root', '/does/not/exist'],
  ]) {
    const result = spawnSync(process.execPath, [scanner, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal((result.stdout + result.stderr).includes('fixture-argv-secret'), false);
  }
});

test('scanner accepts only the exact synthetic fixtures and placeholders', async (t) => {
  const root = await repository({
    'fixtures/allowed-secrets.txt': [
      'OPENAI_COMPATIBLE_API_KEY=sk-test',
      'OPENAI_COMPATIBLE_API_KEY=sk-xxxx',
      'OPENAI_COMPATIBLE_API_KEY=unit-test-provider-credential',
    ].join('\n'),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = scan(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(report(result), { findings: [] });
});

test('scanner skips shell-expanded assignments and unquoted JavaScript identifier references', async (t) => {
  const root = await repository({
    'deploy.sh': 'DEPLOY_OWNER_TOKEN="$(date +%s)-$$-${RANDOM}-$(hostname)"',
    'config.mjs': 'apiKeyMasked: openaiCompatibleRuntimeCredentialReference',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = scan(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(report(result), { findings: [] });
});

test('scanner allows the model-provider synthetic fixture only at its exact path', async (t) => {
  const syntheticProviderFixture = ['sk', 'raw', 'should', 'never', 'return'].join('-');
  const root = await repository({
    'server/modelProviderRegistry.test.mjs': `apiKey: ${syntheticProviderFixture}`,
    'fixtures/not-allowed.txt': `API_KEY=${syntheticProviderFixture}`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = scan(root);
  assert.equal(result.status, 1);
  assert.deepEqual(report(result).findings, [{
    file: 'fixtures/not-allowed.txt',
    line: 1,
    rule: 'provider_token',
    length: syntheticProviderFixture.length,
  }]);
});

test('scanner reads tracked symlink text without following its target', async (t) => {
  const root = await repository({ 'tracked.txt': 'ordinary text' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'meiao-secret-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const external = path.join(outside, 'credential.txt');
  await writeFile(external, 'sk-' + 'S'.repeat(40));
  await symlink(external, path.join(root, 'tracked-link'));
  assert.equal(spawnSync('git', ['add', 'tracked-link'], { cwd: root }).status, 0);

  const result = scan(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(report(result), { findings: [] });
});

test('scanner fails closed when a tracked regular file becomes unsupported', async (t) => {
  const root = await repository({ 'replaced.txt': 'ordinary text' });
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(path.join(root, 'replaced.txt'));
  await mkdir(path.join(root, 'replaced.txt'));

  const result = scan(root);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('replaced.txt'), false);
});
