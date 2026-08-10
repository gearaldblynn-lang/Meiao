import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
export const EXPECTED_MDX_YAML = `models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.th$/u;
const WHISPER_REPOSITORY = 'Systran/faster-whisper-base';
const WHISPER_REVISION = 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66';
const WHISPER_FILE_NAMES = Object.freeze([
  'config.json',
  'model.bin',
  'tokenizer.json',
  'vocabulary.txt',
]);

class InstallerConfigError extends Error {
  constructor(name, min, max) {
    super(`invalid ${name}: expected integer in range ${min}-${max}`);
    this.name = 'InstallerConfigError';
  }
}

class InstallerRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InstallerRuntimeError';
  }
}

function readBoundedInteger(env, name, fallback, { min, max }) {
  const raw = String(env[name] ?? '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/u.test(raw)) throw new InstallerConfigError(name, min, max);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new InstallerConfigError(name, min, max);
  return value;
}

const isValidManifest = (manifest) => manifest && manifest.schemaVersion === 1 && manifest.model === 'mdx'
  && Array.isArray(manifest.files) && manifest.files.length > 0
  && manifest.files.every((file) => SAFE_FILE_NAME.test(String(file?.name || ''))
    && /^https:\/\/[^/?#]+(?:\/[A-Za-z0-9._-]+)*\/[A-Za-z0-9._-]+\.th$/u.test(String(file?.url || ''))
    && Number.isInteger(file?.size) && file.size > 0 && /^[a-f0-9]{64}$/u.test(String(file?.sha256 || '')));

const isValidWhisperManifest = (manifest) => manifest
  && manifest.schemaVersion === 1
  && manifest.repository === WHISPER_REPOSITORY
  && manifest.revision === WHISPER_REVISION
  && manifest.runtime?.package === 'faster-whisper'
  && manifest.runtime?.version === '1.2.1'
  && manifest.runtime?.ctranslate2Version === '4.6.0'
  && manifest.runtime?.device === 'cpu'
  && manifest.runtime?.computeType === 'int8'
  && Array.isArray(manifest.files)
  && manifest.files.length === WHISPER_FILE_NAMES.length
  && manifest.files.every((file, index) => {
    const name = String(file?.name || '');
    return name === WHISPER_FILE_NAMES[index]
      && String(file?.url || '') === `https://huggingface.co/${WHISPER_REPOSITORY}/resolve/${WHISPER_REVISION}/${name}`
      && Number.isInteger(file?.size)
      && file.size > 0
      && /^[a-f0-9]{64}$/u.test(String(file?.sha256 || ''));
  });

function runtimeRequirementsFile(runtime = process) {
  const platform = String(runtime?.platform || '');
  const arch = String(runtime?.arch || '');
  if (platform === 'linux' && arch === 'x64') return 'requirements.lock';
  if (platform === 'darwin' && arch === 'arm64') return 'requirements-darwin-arm64.lock';
  throw new InstallerRuntimeError('unsupported voiceover runtime: expected linux/x64 or darwin/arm64');
}

function installerPaths(env = {}, runtime = process) {
  const voiceoverDir = path.join(PROJECT_ROOT, 'deploy', 'voiceover');
  const runtimeDir = path.join(voiceoverDir, '.runtime');
  return {
    requirementsIn: path.join(voiceoverDir, 'requirements.in'),
    requirementsLock: path.join(voiceoverDir, runtimeRequirementsFile(runtime)),
    buildRequirementsLock: path.join(voiceoverDir, 'build-requirements.lock'),
    manifestPath: path.join(voiceoverDir, 'demucs-models.json'),
    whisperManifestPath: path.join(voiceoverDir, 'whisper-model.json'),
    yamlPath: path.join(voiceoverDir, 'mdx.yaml'),
    venvDir: String(env.MEIAO_VOICEOVER_VENV_DIR || '').trim() || path.join(runtimeDir, 'venv'),
    modelDir: String(env.MEIAO_VOICEOVER_DEMUCS_MODEL_DIR || '').trim() || path.join(runtimeDir, 'models'),
    whisperModelDir: String(env.MEIAO_VOICEOVER_WHISPER_MODEL_DIR || '').trim()
      || path.join(runtimeDir, 'faster-whisper-base'),
    installPython: String(env.MEIAO_VOICEOVER_INSTALL_PYTHON || '').trim() || 'python3',
    pipTimeoutSeconds: readBoundedInteger(env, 'MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS', 600, {
      min: 30, max: 3600,
    }),
    pipRetries: readBoundedInteger(env, 'MEIAO_VOICEOVER_PIP_RETRIES', 8, {
      min: 0, max: 20,
    }),
  };
}

export async function loadDemucsManifest(manifestPath, deps = {}) {
  const read = deps.readFile || readFile;
  let manifest;
  try {
    manifest = JSON.parse(await read(manifestPath, 'utf8'));
  } catch {
    throw new Error('invalid Demucs model manifest');
  }
  if (!isValidManifest(manifest)) throw new Error('invalid Demucs model manifest');
  return manifest;
}

export async function loadWhisperManifest(manifestPath, deps = {}) {
  const read = deps.readFile || readFile;
  let manifest;
  try {
    manifest = JSON.parse(await read(manifestPath, 'utf8'));
  } catch {
    throw new Error('invalid Whisper model manifest');
  }
  if (!isValidWhisperManifest(manifest)) throw new Error('invalid Whisper model manifest');
  return manifest;
}

async function sha256File(filePath, deps = {}) {
  const stream = deps.createReadStream || createReadStream;
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = stream(filePath);
    input.once('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.once('end', resolve);
  });
  return hash.digest('hex');
}

export async function verifyDemucsModelFiles({ manifest, modelDir, deps = {} }) {
  if (!isValidManifest(manifest)) return { ready: false, files: [] };
  const getLstat = deps.lstat || lstat;
  const files = await Promise.all(manifest.files.map(async (file) => {
    try {
      const target = path.join(modelDir, file.name);
      const metadata = await getLstat(target);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.size) return { name: file.name, ready: false };
      const hash = await sha256File(target, deps);
      return { name: file.name, ready: hash === file.sha256 };
    } catch {
      return { name: file.name, ready: false };
    }
  }));
  return { ready: files.every((file) => file.ready), files };
}

export async function verifyWhisperModelFiles({ manifest, modelDir, deps = {} }) {
  if (!isValidWhisperManifest(manifest)) return { ready: false, files: [] };
  const getLstat = deps.lstat || lstat;
  const readDir = deps.readdir || readdir;
  let exactInventory = false;
  try {
    const directory = await getLstat(modelDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      return { ready: false, files: [] };
    }
    const names = (await readDir(modelDir)).sort();
    exactInventory = names.length === WHISPER_FILE_NAMES.length
      && names.every((name, index) => name === [...WHISPER_FILE_NAMES].sort()[index]);
  } catch {
    return { ready: false, files: [] };
  }
  const files = await Promise.all(manifest.files.map(async (file) => {
    try {
      const target = path.join(modelDir, file.name);
      const metadata = await getLstat(target);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.size) {
        return { name: file.name, ready: false };
      }
      const hash = await sha256File(target, deps);
      return { name: file.name, ready: hash === file.sha256 };
    } catch {
      return { name: file.name, ready: false };
    }
  }));
  return { ready: exactInventory && files.every((file) => file.ready), files };
}

async function verifyYaml(yamlPath, deps = {}) {
  const read = deps.readFile || readFile;
  try {
    return (await read(yamlPath, 'utf8')) === EXPECTED_MDX_YAML;
  } catch {
    return false;
  }
}

async function runSpawn(command, args, options, spawnProcess = null) {
  const normalizedOptions = { ...options, shell: false, stdio: ['ignore', 'inherit', 'inherit'] };
  if (spawnProcess) {
    const result = await spawnProcess(command, args, normalizedOptions);
    if (result?.exitCode === 0) return result;
    throw new Error('voiceover installer process failed');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, normalizedOptions);
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode === 0) resolve({ exitCode });
      else reject(new Error('voiceover installer process failed'));
    });
  });
}

async function defaultDownloadToFile(url, target) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error('voiceover model download failed');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}

function parseMode(argv) {
  const modes = argv.filter((value) => [
    '--check',
    '--install',
    '--download-models',
    '--download-whisper-model',
  ].includes(value));
  if (modes.length !== 1 || argv.length !== 1) throw new Error('choose exactly one installer mode');
  return modes[0].slice(2);
}

async function downloadModels({ manifest, modelDir, deps }) {
  const getStat = deps.stat || stat;
  const remove = deps.rm || rm;
  const publish = deps.link || link;
  const makeDir = deps.mkdir || mkdir;
  const download = deps.downloadToFile || defaultDownloadToFile;
  await makeDir(modelDir, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    const target = path.join(modelDir, file.name);
    const partial = `${target}.part`;
    try {
      const existing = await verifyDemucsModelFiles({ manifest: { ...manifest, files: [file] }, modelDir, deps });
      if (existing.ready) continue;
      await remove(partial, { force: true });
      await download(file.url, partial);
      const metadata = await getStat(partial);
      const hash = await sha256File(partial, deps);
      if (!metadata.isFile() || metadata.size !== file.size || hash !== file.sha256) throw new Error('Demucs model integrity check failed');
      try {
        await publish(partial, target);
      } catch (error) {
        if (error?.code === 'EEXIST') throw new Error('Demucs model target already exists');
        throw error;
      }
      await remove(partial, { force: true });
    } catch (error) {
      await remove(partial, { force: true });
      throw error;
    }
  }
}

async function downloadWhisperModel({ manifest, modelDir, deps }) {
  const existing = await verifyWhisperModelFiles({ manifest, modelDir, deps });
  if (existing.ready) return 0;
  const getLstat = deps.lstat || lstat;
  const makeDir = deps.mkdir || mkdir;
  const makeTempDir = deps.mkdtemp || mkdtemp;
  const remove = deps.rm || rm;
  const publish = deps.rename || rename;
  const download = deps.downloadToFile || defaultDownloadToFile;
  const parentDir = path.dirname(modelDir);
  await makeDir(parentDir, { recursive: true, mode: 0o700 });
  let stagingDir = await makeTempDir(path.join(parentDir, '.faster-whisper-base-'));
  try {
    for (const file of manifest.files) {
      await download(file.url, path.join(stagingDir, file.name));
    }
    const staged = await verifyWhisperModelFiles({ manifest, modelDir: stagingDir, deps });
    if (!staged.ready) throw new Error('Whisper model integrity check failed');
    try {
      await getLstat(modelDir);
      throw new Error('Whisper model target already exists');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await publish(stagingDir, modelDir);
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
        throw new Error('Whisper model target already exists');
      }
      throw error;
    }
    stagingDir = null;
    return manifest.files.length;
  } finally {
    if (stagingDir) await remove(stagingDir, { recursive: true, force: true });
  }
}

async function installYaml({ yamlText, modelDir, deps }) {
  const makeDir = deps.mkdir || mkdir;
  const remove = deps.rm || rm;
  const publish = deps.link || link;
  const write = deps.writeFile || writeFile;
  const read = deps.readFile || readFile;
  const target = path.join(modelDir, 'mdx.yaml');
  const partial = `${target}.part`;
  await makeDir(modelDir, { recursive: true, mode: 0o700 });
  try {
    try {
      if (await read(target, 'utf8') === yamlText) return;
      throw new Error('Demucs model YAML target already exists');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await remove(partial, { force: true });
    await write(partial, yamlText, { flag: 'wx', mode: 0o600 });
    await publish(partial, target);
    await remove(partial, { force: true });
  } catch (error) {
    await remove(partial, { force: true });
    throw error;
  }
}

export async function runInstaller(argv, options = {}) {
  const mode = parseMode(argv);
  const env = options.env || process.env;
  const paths = { ...installerPaths(env, options.runtime || process), ...(options.paths || {}) };
  const deps = options;
  const manifest = await loadDemucsManifest(paths.manifestPath, deps).catch(() => null);
  const whisperManifest = await loadWhisperManifest(paths.whisperManifestPath, deps).catch(() => null);
  const sourceYamlReady = await verifyYaml(paths.yamlPath, deps);
  if ((manifest && !sourceYamlReady) || ((mode === 'install' || mode === 'download-models') && !manifest)) throw new Error('invalid model configuration');
  if (mode === 'download-whisper-model' && !whisperManifest) {
    throw new Error('invalid Whisper model configuration');
  }
  let downloadCalls = 0;
  if (mode === 'download-models') await downloadModels({ manifest, modelDir: paths.modelDir, deps });
  if (mode === 'download-models') downloadCalls = manifest.files.length;
  if (mode === 'download-whisper-model') {
    downloadCalls = await downloadWhisperModel({
      manifest: whisperManifest,
      modelDir: paths.whisperModelDir,
      deps,
    });
  }
  if (mode === 'install') {
    const makeDir = deps.mkdir || mkdir;
    await makeDir(path.dirname(paths.venvDir), { recursive: true, mode: 0o700 });
    try {
      await runSpawn(paths.installPython, [
        '-c',
        'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 64)',
      ], { shell: false }, deps.spawnProcess);
    } catch {
      throw new InstallerRuntimeError('unsupported Python runtime: expected CPython 3.11');
    }
    await runSpawn(paths.installPython, ['-m', 'venv', paths.venvDir], { shell: false }, deps.spawnProcess);
    const venvPython = path.join(paths.venvDir, 'bin', 'python');
    const networkArgs = ['--no-input', '--timeout', String(paths.pipTimeoutSeconds), '--retries', String(paths.pipRetries)];
    await runSpawn(venvPython, ['-m', 'pip', 'install', ...networkArgs, '--require-hashes', '-r', paths.buildRequirementsLock], { shell: false }, deps.spawnProcess);
    await runSpawn(venvPython, ['-m', 'pip', 'install', ...networkArgs, '--require-hashes', '--no-build-isolation', '-r', paths.requirementsLock], { shell: false }, deps.spawnProcess);
  }
  if (mode === 'install' || mode === 'download-models') {
    await installYaml({ yamlText: EXPECTED_MDX_YAML, modelDir: paths.modelDir, deps });
  }
  const yamlReady = await verifyYaml(path.join(paths.modelDir, 'mdx.yaml'), deps);
  const modelResult = manifest ? await verifyDemucsModelFiles({ manifest, modelDir: paths.modelDir, deps }) : { ready: false, files: [] };
  const whisperResult = whisperManifest
    ? await verifyWhisperModelFiles({ manifest: whisperManifest, modelDir: paths.whisperModelDir, deps })
    : { ready: false, files: [] };
  return Object.freeze({
    mode,
    yamlReady,
    modelReady: yamlReady && modelResult.ready,
    whisperReady: whisperResult.ready,
    downloadCalls,
  });
}

async function main() {
  try {
    const result = await runInstaller(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.mode === 'check' && (!result.yamlReady || !result.modelReady || !result.whisperReady)) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof InstallerConfigError || error instanceof InstallerRuntimeError) {
      process.stderr.write(`voiceover Demucs installer configuration error: ${error.message}\n`);
    }
    else process.stderr.write('voiceover Demucs installer failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
