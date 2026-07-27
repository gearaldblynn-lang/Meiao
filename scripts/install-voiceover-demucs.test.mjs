import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadDemucsManifest,
  runInstaller,
  verifyDemucsModelFiles,
} from './install-voiceover-demucs.mjs';

const mdxQYaml = `models: ['6b9c2ca1', 'b72baf4e', '42e558d4', '305bc58f']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;

async function withTempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'meiao-voiceover-installer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('shipped manifest pins only the exact mdx_q model inventory', async () => {
  const manifest = await loadDemucsManifest(new URL('../deploy/voiceover/demucs-models.json', import.meta.url));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.model, 'mdx_q');
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(manifest.files.map((file) => file.name), [
    '6b9c2ca1-3fd82607.th', 'b72baf4e-8778635e.th', '42e558d4-196e0e1b.th', '305bc58f-18378783.th',
  ]);
  assert.ok(manifest.files.every((file) => file.url.startsWith('https://dl.fbaipublicfiles.com/demucs/mdx_final/')));
});

test('Linux CPU lock controls only PyPI and official PyTorch CPU sources and hashes every pin', async () => {
  const source = await readFile(new URL('../deploy/voiceover/requirements.in', import.meta.url), 'utf8');
  const lock = await readFile(new URL('../deploy/voiceover/requirements.lock', import.meta.url), 'utf8');
  assert.match(source, /^--index-url https:\/\/pypi\.org\/simple$/m);
  assert.match(source, /^--extra-index-url https:\/\/download\.pytorch\.org\/whl\/cpu$/m);
  assert.match(source, /^torch==2\.7\.1\+cpu$/m);
  assert.match(source, /^torchaudio==2\.7\.1\+cpu$/m);
  assert.match(lock, /^--index-url https:\/\/pypi\.org\/simple$/m);
  assert.match(lock, /^--extra-index-url https:\/\/download\.pytorch\.org\/whl\/cpu$/m);
  assert.match(lock, /^torch==2\.7\.1\+cpu \\/m);
  assert.match(lock, /^torchaudio==2\.7\.1\+cpu \\/m);
  const pins = [...lock.matchAll(/^([a-z0-9][a-z0-9._-]*)==[^\s]+ \\$/gim)];
  assert.ok(pins.length >= 20);
  for (const pin of pins) {
    const block = lock.slice(pin.index, lock.indexOf('\n\n', pin.index));
    assert.match(block, /--hash=sha256:[a-f0-9]{64}/i, `missing hash for ${pin[1]}`);
  }
});

test('model verification requires exact byte size and sha256', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'models');
  const filePath = join(modelDir, 'model.th');
  const body = Buffer.from('known model bytes');
  await (await import('node:fs/promises')).mkdir(modelDir);
  await writeFile(filePath, body);
  const manifest = { schemaVersion: 1, model: 'mdx_q', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  }] };
  assert.deepEqual(await verifyDemucsModelFiles({ manifest, modelDir }), { ready: true, files: [{ name: 'model.th', ready: true }] });
  await writeFile(filePath, Buffer.from('wrong bytes'));
  assert.deepEqual(await verifyDemucsModelFiles({ manifest, modelDir }), { ready: false, files: [{ name: 'model.th', ready: false }] });
});

test('installer check is read-only and does not download or create a venv', async (t) => {
  const root = await withTempRoot(t);
  const calls = [];
  const result = await runInstaller(['--check'], {
    paths: {
      requirementsLock: join(root, 'requirements.lock'), requirementsIn: join(root, 'requirements.in'),
      manifestPath: join(root, 'manifest.json'), yamlPath: join(root, 'mdx_q.yaml'),
      venvDir: join(root, 'venv'), modelDir: join(root, 'models'),
    },
    spawnProcess: async (...args) => { calls.push(args); return { exitCode: 0 }; },
    downloadToFile: async () => { throw new Error('must not download'); },
  });
  assert.equal(result.mode, 'check');
  assert.equal(calls.length, 0);
  assert.equal(result.downloadCalls, 0);
});

test('CLI check reports a non-ready runtime with a nonzero status and no path disclosure', () => {
  const scriptPath = fileURLToPath(new URL('./install-voiceover-demucs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"mode":"check"/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\/Users\/|\.runtime|https?:\/\//i);
});

test('installer downloads each model via part file and rejects a wrong manifest model or YAML', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'models');
  const modelBytes = Buffer.from('model payload');
  const manifest = { schemaVersion: 1, model: 'mdx_q', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: modelBytes.length,
    sha256: createHash('sha256').update(modelBytes).digest('hex'),
  }] };
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx_q.yaml');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(yamlPath, mdxQYaml);
  const result = await runInstaller(['--download-models'], {
    paths: { manifestPath, yamlPath, modelDir, venvDir: join(root, 'venv'), requirementsLock: join(root, 'requirements.lock'), requirementsIn: join(root, 'requirements.in') },
    downloadToFile: async (_url, target) => writeFile(target, modelBytes),
  });
  assert.equal(result.modelReady, true);
  const downloaded = await (await import('node:fs/promises')).readFile(join(modelDir, 'model.th'));
  assert.deepEqual(downloaded, modelBytes);
  await writeFile(yamlPath, 'models: []\n');
  await assert.rejects(runInstaller(['--check'], { paths: { manifestPath, yamlPath, modelDir, venvDir: join(root, 'venv'), requirementsLock: join(root, 'requirements.lock'), requirementsIn: join(root, 'requirements.in') } }), /invalid model configuration/i);
});

test('model publication never overwrites a target which appears during download', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'models');
  const modelBytes = Buffer.from('expected model');
  const manifest = { schemaVersion: 1, model: 'mdx_q', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: modelBytes.length,
    sha256: createHash('sha256').update(modelBytes).digest('hex'),
  }] };
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx_q.yaml');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(yamlPath, mdxQYaml);
  await assert.rejects(runInstaller(['--download-models'], {
    paths: { manifestPath, yamlPath, modelDir, venvDir: join(root, 'venv'), requirementsLock: join(root, 'requirements.lock'), requirementsIn: join(root, 'requirements.in') },
    downloadToFile: async (_url, partial) => {
      await writeFile(partial, modelBytes);
      await (await import('node:fs/promises')).mkdir(modelDir, { recursive: true });
      await writeFile(join(modelDir, 'model.th'), Buffer.from('concurrent file'));
    },
  }), /target already exists/i);
  assert.deepEqual(await readFile(join(modelDir, 'model.th')), Buffer.from('concurrent file'));
});

test('installer delegates a hash-enforced venv install without a shell', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx_q.yaml');
  const requirementsLock = join(root, 'requirements.lock');
  const venvDir = join(root, 'venv');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx_q', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxQYaml);
  await writeFile(requirementsLock, '--index-url https://pypi.org/simple\n');
  const calls = [];
  const result = await runInstaller(['--install'], {
    paths: { manifestPath, yamlPath, requirementsLock, venvDir, modelDir: join(root, 'models'), installPython: 'python3' },
    spawnProcess: async (command, args, options) => { calls.push({ command, args, options }); return { exitCode: 0 }; },
  });
  assert.equal(result.mode, 'install');
  assert.equal(result.modelReady, false);
  assert.deepEqual(calls, [
    { command: 'python3', args: ['-m', 'venv', venvDir], options: { shell: false } },
    { command: join(venvDir, 'bin', 'python'), args: ['-m', 'pip', 'install', '--require-hashes', '-r', requirementsLock], options: { shell: false } },
  ]);
});

test('installer rejects a manifest with a non-mdx_q model before creating a venv', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx_q.yaml');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'other', files: [] }));
  await writeFile(yamlPath, mdxQYaml);
  let spawnCalls = 0;
  await assert.rejects(runInstaller(['--install'], {
    paths: { manifestPath, yamlPath, requirementsLock: join(root, 'requirements.lock'), venvDir: join(root, 'venv'), modelDir: join(root, 'models'), installPython: 'python3' },
    spawnProcess: async () => { spawnCalls += 1; return { exitCode: 0 }; },
  }), /invalid model configuration/i);
  assert.equal(spawnCalls, 0);
});
