import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadDemucsManifest,
  loadWhisperManifest,
  runInstaller,
  verifyDemucsModelFiles,
  verifyWhisperModelFiles,
} from './install-voiceover-demucs.mjs';

const mdxYaml = `models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;

const assertEveryPinHasHashes = (lockedText, minimumPins) => {
  const blocks = lockedText.split(/\n(?=[a-z0-9][a-z0-9._-]*==)/i).filter((block) => /^[a-z0-9][a-z0-9._-]*==/i.test(block));
  assert.ok(blocks.length >= minimumPins);
  for (const block of blocks) {
    const pin = block.match(/^([a-z0-9][a-z0-9._-]*==[^\s]+)/i)?.[1];
    assert.ok(pin, 'missing pinned package header');
    assert.match(block, /^\s*--hash=sha256:[a-f0-9]{64}/im, `missing hash for ${pin}`);
  }
};

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
  assert.match(source, /^soundfile==0\.13\.1$/m);
  assert.match(source, /^faster-whisper==1\.2\.1$/m);
  assert.match(source, /^ctranslate2==4\.6\.0$/m);
  assert.match(lock, /^--index-url https:\/\/pypi\.org\/simple$/m);
  assert.match(lock, /^--extra-index-url https:\/\/download\.pytorch\.org\/whl\/cpu$/m);
  assert.match(lock, /^torch==2\.7\.1\+cpu \\/m);
  assert.match(lock, /^torchaudio==2\.7\.1\+cpu \\/m);
  assert.match(lock, /^soundfile==0\.13\.1 \\/m);
  assert.match(lock, /^faster-whisper==1\.2\.1 \\/m);
  assert.match(lock, /^ctranslate2==4\.6\.0 \\/m);
  assertEveryPinHasHashes(lock, 30);
  const buildLock = await readFile(new URL('../deploy/voiceover/build-requirements.lock', import.meta.url), 'utf8');
  assert.match(buildLock, /^setuptools==80\.9\.0 \\/m);
  assert.match(buildLock, /^wheel==0\.45\.1 \\/m);
  assertEveryPinHasHashes(buildLock, 2);
  assert.equal(/diffq/i.test(`${source}\n${lock}\n${buildLock}`), false);
});

test('macOS arm64 lock uses official PyPI torch packages and hashes every pin', async () => {
  const source = await readFile(new URL('../deploy/voiceover/requirements-darwin-arm64.in', import.meta.url), 'utf8');
  const lock = await readFile(new URL('../deploy/voiceover/requirements-darwin-arm64.lock', import.meta.url), 'utf8');
  assert.match(source, /^--index-url https:\/\/pypi\.org\/simple$/m);
  assert.doesNotMatch(source, /download\.pytorch\.org/);
  assert.match(source, /^torch==2\.7\.1$/m);
  assert.match(source, /^torchaudio==2\.7\.1$/m);
  assert.match(source, /^soundfile==0\.13\.1$/m);
  assert.match(source, /^faster-whisper==1\.2\.1$/m);
  assert.match(source, /^ctranslate2==4\.6\.0$/m);
  assert.match(lock, /^--index-url https:\/\/pypi\.org\/simple$/m);
  assert.doesNotMatch(lock, /download\.pytorch\.org/);
  assert.match(lock, /^torch==2\.7\.1 \\/m);
  assert.match(lock, /^torchaudio==2\.7\.1 \\/m);
  assert.match(lock, /^soundfile==0\.13\.1 \\/m);
  assert.match(lock, /^faster-whisper==1\.2\.1 \\/m);
  assert.match(lock, /^ctranslate2==4\.6\.0 \\/m);
  assertEveryPinHasHashes(lock, 30);
});

test('shipped Whisper manifest pins the exact official faster-whisper base inventory', async () => {
  const manifest = await loadWhisperManifest(
    new URL('../deploy/voiceover/whisper-model.json', import.meta.url),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repository, 'Systran/faster-whisper-base');
  assert.equal(manifest.revision, 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66');
  assert.deepEqual(manifest.runtime, {
    package: 'faster-whisper',
    version: '1.2.1',
    ctranslate2Version: '4.6.0',
    device: 'cpu',
    computeType: 'int8',
  });
  assert.deepEqual(manifest.files, [
    {
      name: 'config.json',
      url: 'https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/config.json',
      size: 2309,
      sha256: '56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a',
    },
    {
      name: 'model.bin',
      url: 'https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/model.bin',
      size: 145217532,
      sha256: 'd01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9',
    },
    {
      name: 'tokenizer.json',
      url: 'https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/tokenizer.json',
      size: 2203239,
      sha256: 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    },
    {
      name: 'vocabulary.txt',
      url: 'https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/vocabulary.txt',
      size: 459861,
      sha256: '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
    },
  ]);
});

test('Whisper model verification requires the exact regular-file inventory, sizes, and hashes', async (t) => {
  const root = await withTempRoot(t);
  const modelDir = join(root, 'whisper');
  await (await import('node:fs/promises')).mkdir(modelDir);
  const bodies = new Map([
    ['config.json', Buffer.from('config')],
    ['model.bin', Buffer.from('model')],
    ['tokenizer.json', Buffer.from('tokenizer')],
    ['vocabulary.txt', Buffer.from('vocabulary')],
  ]);
  const manifest = testWhisperManifest(bodies);
  for (const [name, body] of bodies) await writeFile(join(modelDir, name), body);

  assert.equal((await verifyWhisperModelFiles({ manifest, modelDir })).ready, true);
  await writeFile(join(modelDir, 'unexpected.json'), '{}');
  assert.equal((await verifyWhisperModelFiles({ manifest, modelDir })).ready, false);
  await rm(join(modelDir, 'unexpected.json'));
  await writeFile(join(modelDir, 'model.bin'), 'drift');
  assert.equal((await verifyWhisperModelFiles({ manifest, modelDir })).ready, false);
  await rm(join(modelDir, 'model.bin'));
  const linkedModel = join(root, 'linked-model.bin');
  await writeFile(linkedModel, bodies.get('model.bin'));
  await symlink(linkedModel, join(modelDir, 'model.bin'));
  assert.equal((await verifyWhisperModelFiles({ manifest, modelDir })).ready, false);
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
  await rm(filePath);
  const linkedModelPath = join(root, 'linked-model.th');
  await writeFile(linkedModelPath, body);
  await symlink(linkedModelPath, filePath);
  assert.deepEqual(await verifyDemucsModelFiles({ manifest, modelDir }), { ready: false, files: [{ name: 'model.th', ready: false }] });
});

test('installer check is read-only and does not download or create a venv', async (t) => {
  const root = await withTempRoot(t);
  const calls = [];
  const whisperManifestPath = join(root, 'whisper-manifest.json');
  const whisperModelDir = join(root, 'whisper');
  await writeFile(whisperManifestPath, JSON.stringify(testWhisperManifest(new Map([
    ['config.json', Buffer.from('config')],
    ['model.bin', Buffer.from('model')],
    ['tokenizer.json', Buffer.from('tokenizer')],
    ['vocabulary.txt', Buffer.from('vocabulary')],
  ]))));
  const result = await runInstaller(['--check'], {
    paths: {
      requirementsLock: join(root, 'requirements.lock'), requirementsIn: join(root, 'requirements.in'),
      manifestPath: join(root, 'manifest.json'), yamlPath: join(root, 'mdx.yaml'),
      venvDir: join(root, 'venv'), modelDir: join(root, 'models'),
      whisperManifestPath, whisperModelDir,
    },
    spawnProcess: async (...args) => { calls.push(args); return { exitCode: 0 }; },
    downloadToFile: async () => { throw new Error('must not download'); },
  });
  assert.equal(result.mode, 'check');
  assert.equal(result.whisperReady, false);
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
  assert.deepEqual(missingRuntimeYaml, {
    mode: 'check',
    yamlReady: false,
    modelReady: false,
    whisperReady: false,
    downloadCalls: 0,
  });
  await (await import('node:fs/promises')).mkdir(modelDir);
  await writeFile(join(modelDir, 'mdx.yaml'), 'models: []\n');
  const driftedRuntimeYaml = await runInstaller(['--check'], { paths });
  assert.deepEqual(driftedRuntimeYaml, {
    mode: 'check',
    yamlReady: false,
    modelReady: false,
    whisperReady: false,
    downloadCalls: 0,
  });
});

test('explicit Whisper download verifies all files before publishing one complete directory', async (t) => {
  const root = await withTempRoot(t);
  const whisperModelDir = join(root, 'faster-whisper-base');
  const whisperManifestPath = join(root, 'whisper-manifest.json');
  const bodies = new Map([
    ['config.json', Buffer.from('config')],
    ['model.bin', Buffer.from('model')],
    ['tokenizer.json', Buffer.from('tokenizer')],
    ['vocabulary.txt', Buffer.from('vocabulary')],
  ]);
  await writeFile(whisperManifestPath, JSON.stringify(testWhisperManifest(bodies)));
  const urls = [];
  const result = await runInstaller(['--download-whisper-model'], {
    paths: { whisperManifestPath, whisperModelDir },
    downloadToFile: async (url, target) => {
      urls.push(url);
      const name = new URL(url).pathname.split('/').at(-1);
      await writeFile(target, bodies.get(name));
    },
  });
  assert.equal(result.mode, 'download-whisper-model');
  assert.equal(result.whisperReady, true);
  assert.equal(result.downloadCalls, 4);
  assert.deepEqual(urls, [...bodies.keys()].map((name) => (
    `https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/${name}`
  )));
  assert.deepEqual((await (await import('node:fs/promises')).readdir(whisperModelDir)).sort(), [...bodies.keys()].sort());
});

test('Whisper publication never overwrites a target directory which appears during download', async (t) => {
  const root = await withTempRoot(t);
  const whisperModelDir = join(root, 'faster-whisper-base');
  const whisperManifestPath = join(root, 'whisper-manifest.json');
  const bodies = new Map([
    ['config.json', Buffer.from('config')],
    ['model.bin', Buffer.from('model')],
    ['tokenizer.json', Buffer.from('tokenizer')],
    ['vocabulary.txt', Buffer.from('vocabulary')],
  ]);
  await writeFile(whisperManifestPath, JSON.stringify(testWhisperManifest(bodies)));
  let calls = 0;
  await assert.rejects(runInstaller(['--download-whisper-model'], {
    paths: { whisperManifestPath, whisperModelDir },
    downloadToFile: async (url, target) => {
      const name = new URL(url).pathname.split('/').at(-1);
      await writeFile(target, bodies.get(name));
      calls += 1;
      if (calls === bodies.size) {
        await (await import('node:fs/promises')).mkdir(whisperModelDir);
        await writeFile(join(whisperModelDir, 'claimed.txt'), 'keep');
      }
    },
  }), /target already exists/i);
  assert.equal(await readFile(join(whisperModelDir, 'claimed.txt'), 'utf8'), 'keep');
});

test('CLI check reports a non-ready runtime with a nonzero status and no path disclosure', () => {
  const scriptPath = fileURLToPath(new URL('./install-voiceover-demucs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--check'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MEIAO_VOICEOVER_DEMUCS_MODEL_DIR: '/tmp/meiao-voiceover-missing-runtime-for-cli-test',
    },
  });
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

test('CLI reports allowlisted invalid pip controls without echoing the supplied value', () => {
  const scriptPath = fileURLToPath(new URL('./install-voiceover-demucs.mjs', import.meta.url));
  const secretLikeValue = '999999999999';
  const result = spawnSync(process.execPath, [scriptPath, '--install'], {
    encoding: 'utf8',
    env: { ...process.env, MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS: secretLikeValue },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS/);
  assert.match(result.stderr, /30-3600/);
  assert.doesNotMatch(result.stderr, new RegExp(secretLikeValue));
  assert.doesNotMatch(result.stderr, /\/Users\/|\/opt\/|https?:\/\//i);
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
    env: {
      MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS: '900',
      MEIAO_VOICEOVER_PIP_RETRIES: '12',
    },
    paths: { manifestPath, yamlPath, requirementsLock, buildRequirementsLock, venvDir, modelDir: join(root, 'models'), installPython: 'python3' },
    spawnProcess: async (command, args, options) => { calls.push({ command, args, options }); return { exitCode: 0 }; },
  });
  assert.equal(result.mode, 'install');
  assert.equal(result.modelReady, false);
  assert.deepEqual(calls, [
    {
      command: 'python3',
      args: ['-c', 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 64)'],
      options: { shell: false, stdio: ['ignore', 'inherit', 'inherit'] },
    },
    {
      command: 'python3', args: ['-m', 'venv', venvDir],
      options: { shell: false, stdio: ['ignore', 'inherit', 'inherit'] },
    },
    {
      command: join(venvDir, 'bin', 'python'),
      args: ['-m', 'pip', 'install', '--no-input', '--timeout', '900', '--retries', '12', '--require-hashes', '-r', buildRequirementsLock],
      options: { shell: false, stdio: ['ignore', 'inherit', 'inherit'] },
    },
    {
      command: join(venvDir, 'bin', 'python'),
      args: ['-m', 'pip', 'install', '--no-input', '--timeout', '900', '--retries', '12', '--require-hashes', '--no-build-isolation', '-r', requirementsLock],
      options: { shell: false, stdio: ['ignore', 'inherit', 'inherit'] },
    },
  ]);
});

test('installer selects the macOS arm64 lock and checks CPython 3.11 before creating the venv', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  const buildRequirementsLock = join(root, 'build-requirements.lock');
  const venvDir = join(root, 'venv');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxYaml);
  const calls = [];
  await runInstaller(['--install'], {
    runtime: { platform: 'darwin', arch: 'arm64' },
    paths: {
      manifestPath, yamlPath, buildRequirementsLock, venvDir,
      modelDir: join(root, 'models'), installPython: 'python3.11',
    },
    spawnProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 0 };
    },
  });
  assert.deepEqual(calls[0], {
    command: 'python3.11',
    args: ['-c', 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 64)'],
    options: { shell: false, stdio: ['ignore', 'inherit', 'inherit'] },
  });
  assert.deepEqual(calls[1], {
    command: 'python3.11',
    args: ['-m', 'venv', venvDir],
    options: { shell: false, stdio: ['ignore', 'inherit', 'inherit'] },
  });
  assert.match(calls[3].args.at(-1), /requirements-darwin-arm64\.lock$/);
});

test('installer rejects a non-3.11 Python before creating the venv', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxYaml);
  const calls = [];
  await assert.rejects(runInstaller(['--install'], {
    runtime: { platform: 'darwin', arch: 'arm64' },
    paths: {
      manifestPath, yamlPath, buildRequirementsLock: join(root, 'build.lock'),
      venvDir: join(root, 'venv'), modelDir: join(root, 'models'), installPython: 'python3',
    },
    spawnProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 64 };
    },
  }), /CPython 3\.11/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], '-c');
});

test('installer rejects invalid pip network controls before creating a venv', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxYaml);
  let spawnCalls = 0;
  await assert.rejects(runInstaller(['--install'], {
    env: { MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS: '0' },
    paths: {
      manifestPath, yamlPath, requirementsLock: join(root, 'requirements.lock'),
      buildRequirementsLock: join(root, 'build.lock'), venvDir: join(root, 'venv'),
      modelDir: join(root, 'models'), installPython: 'python3',
    },
    spawnProcess: async () => { spawnCalls += 1; return { exitCode: 0 }; },
  }), /MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS.*30-3600/i);
  assert.equal(spawnCalls, 0);
});

test('installer stops after a failed pip subprocess and does not publish runtime YAML', async (t) => {
  const root = await withTempRoot(t);
  const manifestPath = join(root, 'manifest.json');
  const yamlPath = join(root, 'mdx.yaml');
  const modelDir = join(root, 'models');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, model: 'mdx', files: [{
    name: 'model.th', url: 'https://example.invalid/model.th', size: 1, sha256: '0'.repeat(64),
  }] }));
  await writeFile(yamlPath, mdxYaml);
  const calls = [];
  await assert.rejects(runInstaller(['--install'], {
    paths: {
      manifestPath, yamlPath, requirementsLock: join(root, 'requirements.lock'),
      buildRequirementsLock: join(root, 'build.lock'), venvDir: join(root, 'venv'),
      modelDir, installPython: 'python3',
    },
    spawnProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: calls.length === 3 ? 17 : 0 };
    },
  }), /installer process failed/i);
  assert.equal(calls.length, 3);
  await assert.rejects(readFile(join(modelDir, 'mdx.yaml')), { code: 'ENOENT' });
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

function testWhisperManifest(bodies) {
  const revision = 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66';
  return {
    schemaVersion: 1,
    repository: 'Systran/faster-whisper-base',
    revision,
    runtime: {
      package: 'faster-whisper',
      version: '1.2.1',
      ctranslate2Version: '4.6.0',
      device: 'cpu',
      computeType: 'int8',
    },
    files: [...bodies].map(([name, body]) => ({
      name,
      url: `https://huggingface.co/Systran/faster-whisper-base/resolve/${revision}/${name}`,
      size: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    })),
  };
}
