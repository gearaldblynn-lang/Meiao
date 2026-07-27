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

const mdxYaml = `models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;

async function withTempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'meiao-voiceover-installer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('shipped manifest pins the full official mdx v4.0.1 inventory', async () => {
  const manifest = await loadDemucsManifest(new URL('../deploy/voiceover/demucs-models.json', import.meta.url));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.model, 'mdx');
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(manifest.files.map((file) => file.name), [
    '0d19c1c6-0f06f20e.th', '7ecf8ec1-70f50cc9.th', 'c511e2ab-fe698775.th', '7d865c68-3d5dd56b.th',
  ]);
  assert.deepEqual(manifest.files.map(({ url, size, sha256 }) => ({ url, size, sha256 })), [
    { url: 'https://dl.fbaipublicfiles.com/demucs/mdx_final/0d19c1c6-0f06f20e.th', size: 178048329, sha256: '0f06f20ed6ddc8058fa72ccc4845f3a88916eff7d007b623924193de217bbcf4' },
    { url: 'https://dl.fbaipublicfiles.com/demucs/mdx_final/7ecf8ec1-70f50cc9.th', size: 178048329, sha256: '70f50cc947d08f32e6dd8e2b687d398fa5ef9e51d1bd7600e32205d1f44be6b9' },
    { url: 'https://dl.fbaipublicfiles.com/demucs/mdx_final/c511e2ab-fe698775.th', size: 167334095, sha256: 'fe6987756a7087d339bf63b19bb481b12cea02d3bc0de7583df7597210209649' },
    { url: 'https://dl.fbaipublicfiles.com/demucs/mdx_final/7d865c68-3d5dd56b.th', size: 167918783, sha256: '3d5dd56b5bc986f136dff98655ded22b2b033f465ccec7a28640a6b15fd71ed6' },
  ]);
  assert.equal(await readFile(new URL('../deploy/voiceover/mdx.yaml', import.meta.url), 'utf8'), mdxYaml);
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
  const assertEveryPinHasHashes = (lockedText, minimumPins) => {
    const blocks = lockedText.split(/\n(?=[a-z0-9][a-z0-9._-]*==)/i).filter((block) => /^[a-z0-9][a-z0-9._-]*==/i.test(block));
    assert.ok(blocks.length >= minimumPins);
    for (const block of blocks) {
      const pin = block.match(/^([a-z0-9][a-z0-9._-]*==[^\s]+)/i)?.[1];
      assert.ok(pin, 'missing pinned package header');
      assert.match(block, /^\s*--hash=sha256:[a-f0-9]{64}/im, `missing hash for ${pin}`);
    }
  };
  assertEveryPinHasHashes(lock, 20);
  const buildLock = await readFile(new URL('../deploy/voiceover/build-requirements.lock', import.meta.url), 'utf8');
  assert.match(buildLock, /^setuptools==80\.9\.0 \\/m);
  assert.match(buildLock, /^wheel==0\.45\.1 \\/m);
  assertEveryPinHasHashes(buildLock, 2);
  assert.equal(/diffq/i.test(`${source}\n${lock}\n${buildLock}`), false);
});

test('model verification requires exact byte size and sha256', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'models');
  const filePath = join(modelDir, 'model.th');
  const body = Buffer.from('known model bytes');
  await (await import('node:fs/promises')).mkdir(modelDir);
  await writeFile(filePath, body);
  const manifest = { schemaVersion: 1, model: 'mdx', files: [{
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
      manifestPath: join(root, 'manifest.json'), yamlPath: join(root, 'mdx.yaml'),
      venvDir: join(root, 'venv'), modelDir: join(root, 'models'),
    },
    spawnProcess: async (...args) => { calls.push(args); return { exitCode: 0 }; },
    downloadToFile: async () => { throw new Error('must not download'); },
  });
  assert.equal(result.mode, 'check');
  assert.equal(calls.length, 0);
  assert.equal(result.downloadCalls, 0);
});

test('installer check uses modelDir/mdx.yaml rather than the source YAML as runtime evidence', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'models');
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'source-mdx.yaml');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxYaml);
  const paths = { manifestPath, yamlPath, modelDir, venvDir: join(root, 'venv'), requirementsLock: join(root, 'requirements.lock'), buildRequirementsLock: join(root, 'build.lock') };
  const missingRuntimeYaml = await runInstaller(['--check'], { paths });
  assert.deepEqual(missingRuntimeYaml, { mode: 'check', yamlReady: false, modelReady: false, downloadCalls: 0 });
  await (await import('node:fs/promises')).mkdir(modelDir);
  await writeFile(join(modelDir, 'mdx.yaml'), 'models: []\n');
  const driftedRuntimeYaml = await runInstaller(['--check'], { paths });
  assert.deepEqual(driftedRuntimeYaml, { mode: 'check', yamlReady: false, modelReady: false, downloadCalls: 0 });
});

test('CLI check reports a non-ready runtime with a nonzero status and no path disclosure', () => {
  const scriptPath = fileURLToPath(new URL('./install-voiceover-demucs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"mode":"check"/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\/Users\/|\.runtime|https?:\/\//i);
});

test('CLI check marks a missing configured runtime YAML as non-ready', async (t) => {
  const root = await withTempRoot(t);
  const scriptPath = fileURLToPath(new URL('./install-voiceover-demucs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--check'], {
    encoding: 'utf8', env: { ...process.env, MEIAO_VOICEOVER_DEMUCS_MODEL_DIR: join(root, 'models') },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"yamlReady":false/);
  assert.match(result.stdout, /"modelReady":false/);
});

test('installer downloads each model via part file and rejects a wrong manifest model or YAML', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'models');
  const modelBytes = Buffer.from('model payload');
  const manifest = { schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: modelBytes.length,
    sha256: createHash('sha256').update(modelBytes).digest('hex'),
  }] };
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(yamlPath, mdxYaml);
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
  const manifest = { schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: modelBytes.length,
    sha256: createHash('sha256').update(modelBytes).digest('hex'),
  }] };
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(yamlPath, mdxYaml);
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

test('installer installs the pinned build toolchain before the no-isolation runtime lock', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  const requirementsLock = join(root, 'requirements.lock');
  const buildRequirementsLock = join(root, 'build-requirements.lock');
  const venvDir = join(root, 'venv');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxYaml);
  await writeFile(requirementsLock, '--index-url https://pypi.org/simple\n');
  await writeFile(buildRequirementsLock, '--index-url https://pypi.org/simple\n');
  const calls = [];
  const result = await runInstaller(['--install'], {
    paths: { manifestPath, yamlPath, requirementsLock, buildRequirementsLock, venvDir, modelDir: join(root, 'models'), installPython: 'python3' },
    spawnProcess: async (command, args, options) => { calls.push({ command, args, options }); return { exitCode: 0 }; },
  });
  assert.equal(result.mode, 'install');
  assert.equal(result.modelReady, false);
  assert.deepEqual(calls, [
    { command: 'python3', args: ['-m', 'venv', venvDir], options: { shell: false } },
    { command: join(venvDir, 'bin', 'python'), args: ['-m', 'pip', 'install', '--require-hashes', '-r', buildRequirementsLock], options: { shell: false } },
    { command: join(venvDir, 'bin', 'python'), args: ['-m', 'pip', 'install', '--require-hashes', '--no-build-isolation', '-r', requirementsLock], options: { shell: false } },
  ]);
});

test('installer rejects a manifest with a non-mdx model before creating a venv', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'other', files: [] }));
  await writeFile(yamlPath, mdxYaml);
  let spawnCalls = 0;
  await assert.rejects(runInstaller(['--install'], {
    paths: { manifestPath, yamlPath, requirementsLock: join(root, 'requirements.lock'), venvDir: join(root, 'venv'), modelDir: join(root, 'models'), installPython: 'python3' },
    spawnProcess: async () => { spawnCalls += 1; return { exitCode: 0 }; },
  }), /invalid model configuration/i);
  assert.equal(spawnCalls, 0);
});
