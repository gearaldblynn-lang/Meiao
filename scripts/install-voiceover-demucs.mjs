import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
export const EXPECTED_MDX_YAML = `models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.th$/u;

class InstallerConfigError extends Error {
  constructor(name, min, max) {
    super(`invalid ${name}: expected integer in range ${min}-${max}`);
    this.name = 'InstallerConfigError';
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

function installerPaths(env = {}) {
  const voiceoverDir = path.join(PROJECT_ROOT, 'deploy', 'voiceover');
  const runtimeDir = path.join(voiceoverDir, '.runtime');
  return {
    requirementsIn: path.join(voiceoverDir, 'requirements.in'),
    requirementsLock: path.join(voiceoverDir, 'requirements.lock'),
    buildRequirementsLock: path.join(voiceoverDir, 'build-requirements.lock'),
    manifestPath: path.join(voiceoverDir, 'demucs-models.json'),
    yamlPath: path.join(voiceoverDir, 'mdx.yaml'),
    venvDir: String(env.MEIAO_VOICEOVER_VENV_DIR || '').trim() || path.join(runtimeDir, 'venv'),
    modelDir: String(env.MEIAO_VOICEOVER_DEMUCS_MODEL_DIR || '').trim() || path.join(runtimeDir, 'models'),
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
  const getStat = deps.stat || stat;
  const files = await Promise.all(manifest.files.map(async (file) => {
    try {
      const target = path.join(modelDir, file.name);
      const metadata = await getStat(target);
      if (!metadata.isFile() || metadata.size !== file.size) return { name: file.name, ready: false };
      const hash = await sha256File(target, deps);
      return { name: file.name, ready: hash === file.sha256 };
    } catch {
      return { name: file.name, ready: false };
    }
  }));
  return { ready: files.every((file) => file.ready), files };
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
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Demucs model download failed');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}

function parseMode(argv) {
  const modes = argv.filter((value) => ['--check', '--install', '--download-models'].includes(value));
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
  const paths = { ...installerPaths(env), ...(options.paths || {}) };
  const deps = options;
  const manifest = await loadDemucsManifest(paths.manifestPath, deps).catch(() => null);
  const sourceYamlReady = await verifyYaml(paths.yamlPath, deps);
  if ((manifest && !sourceYamlReady) || ((mode === 'install' || mode === 'download-models') && !manifest)) throw new Error('invalid model configuration');
  if (mode === 'download-models') await downloadModels({ manifest, modelDir: paths.modelDir, deps });
  if (mode === 'install') {
    const makeDir = deps.mkdir || mkdir;
    await makeDir(path.dirname(paths.venvDir), { recursive: true, mode: 0o700 });
    await runSpawn(paths.installPython, ['-m', 'venv', paths.venvDir], { shell: false }, deps.spawnProcess);
    const venvPython = path.join(paths.venvDir, 'bin', 'python');
    const networkArgs = ['--no-input', '--timeout', String(paths.pipTimeoutSeconds), '--retries', String(paths.pipRetries)];
    await runSpawn(venvPython, ['-m', 'pip', 'install', ...networkArgs, '--require-hashes', '-r', paths.buildRequirementsLock], { shell: false }, deps.spawnProcess);
    await runSpawn(venvPython, ['-m', 'pip', 'install', ...networkArgs, '--require-hashes', '--no-build-isolation', '-r', paths.requirementsLock], { shell: false }, deps.spawnProcess);
  }
  if (mode !== 'check') await installYaml({ yamlText: EXPECTED_MDX_YAML, modelDir: paths.modelDir, deps });
  const yamlReady = await verifyYaml(path.join(paths.modelDir, 'mdx.yaml'), deps);
  const modelResult = manifest ? await verifyDemucsModelFiles({ manifest, modelDir: paths.modelDir, deps }) : { ready: false, files: [] };
  return Object.freeze({ mode, yamlReady, modelReady: yamlReady && modelResult.ready, downloadCalls: mode === 'download-models' ? manifest.files.length : 0 });
}

async function main() {
  try {
    const result = await runInstaller(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.mode === 'check' && (!result.yamlReady || !result.modelReady)) process.exitCode = 1;
  } catch (error) {
    if (error instanceof InstallerConfigError) process.stderr.write(`voiceover Demucs installer configuration error: ${error.message}\n`);
    else process.stderr.write('voiceover Demucs installer failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
