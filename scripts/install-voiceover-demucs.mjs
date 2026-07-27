import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const EXPECTED_YAML = `models: ['6b9c2ca1', 'b72baf4e', '42e558d4', '305bc58f']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.th$/u;

const isValidManifest = (manifest) => manifest && manifest.schemaVersion === 1 && manifest.model === 'mdx_q'
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
    manifestPath: path.join(voiceoverDir, 'demucs-models.json'),
    yamlPath: path.join(voiceoverDir, 'mdx_q.yaml'),
    venvDir: String(env.MEIAO_VOICEOVER_VENV_DIR || '').trim() || path.join(runtimeDir, 'venv'),
    modelDir: String(env.MEIAO_VOICEOVER_DEMUCS_MODEL_DIR || '').trim() || path.join(runtimeDir, 'models'),
    installPython: String(env.MEIAO_VOICEOVER_INSTALL_PYTHON || '').trim() || 'python3',
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
    return (await read(yamlPath, 'utf8')) === EXPECTED_YAML;
  } catch {
    return false;
  }
}

function runSpawn(command, args, options, spawnProcess = null) {
  if (spawnProcess) return Promise.resolve(spawnProcess(command, args, options));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: 'ignore' });
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

export async function runInstaller(argv, options = {}) {
  const mode = parseMode(argv);
  const env = options.env || process.env;
  const paths = { ...installerPaths(env), ...(options.paths || {}) };
  const deps = options;
  const manifest = await loadDemucsManifest(paths.manifestPath, deps).catch(() => null);
  const yamlReady = await verifyYaml(paths.yamlPath, deps);
  if ((manifest && !yamlReady) || ((mode === 'install' || mode === 'download-models') && !manifest)) throw new Error('invalid model configuration');
  if (mode === 'download-models') await downloadModels({ manifest, modelDir: paths.modelDir, deps });
  if (mode === 'install') {
    const makeDir = deps.mkdir || mkdir;
    await makeDir(path.dirname(paths.venvDir), { recursive: true, mode: 0o700 });
    await runSpawn(paths.installPython, ['-m', 'venv', paths.venvDir], { shell: false }, deps.spawnProcess);
    const venvPython = path.join(paths.venvDir, 'bin', 'python');
    await runSpawn(venvPython, ['-m', 'pip', 'install', '--require-hashes', '-r', paths.requirementsLock], { shell: false }, deps.spawnProcess);
  }
  const modelResult = manifest ? await verifyDemucsModelFiles({ manifest, modelDir: paths.modelDir, deps }) : { ready: false, files: [] };
  return Object.freeze({ mode, yamlReady, modelReady: modelResult.ready, downloadCalls: mode === 'download-models' ? manifest.files.length : 0 });
}

async function main() {
  try {
    const result = await runInstaller(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.mode === 'check' && (!result.yamlReady || !result.modelReady)) process.exitCode = 1;
  } catch {
    process.stderr.write('voiceover Demucs installer failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
