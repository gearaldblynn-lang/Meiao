import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVoiceoverError, getVoiceoverConfig } from './voiceoverContract.mjs';
import { loadDemucsManifest, verifyDemucsModelFiles } from '../scripts/install-voiceover-demucs.mjs';

const REQUIRED_FILTERS = Object.freeze(['sidechaincompress', 'amix', 'adelay', 'afade', 'atempo', 'alimiter']);
const EXPECTED_YAML = `models: ['6b9c2ca1', 'b72baf4e', '42e558d4', '305bc58f']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(MODULE_DIR, '..', 'deploy', 'voiceover', 'demucs-models.json');
const YAML_PATH = path.join(MODULE_DIR, '..', 'deploy', 'voiceover', 'mdx_q.yaml');

let activeSeparations = 0;
const separationQueue = [];

function abortError() {
  return Object.assign(new Error('voiceover separation cancelled'), { name: 'AbortError', code: 'voiceover_separation_cancelled' });
}

function acquireSeparationPermit(signal, limit) {
  return new Promise((resolve, reject) => {
    const entry = { signal, limit, resolve, reject, settled: false };
    const abort = () => {
      if (entry.settled) return;
      entry.settled = true;
      const index = separationQueue.indexOf(entry);
      if (index >= 0) separationQueue.splice(index, 1);
      reject(abortError());
    };
    entry.abort = abort;
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    separationQueue.push(entry);
    pumpSeparationQueue();
  });
}

function pumpSeparationQueue() {
  while (separationQueue.length > 0) {
    const entry = separationQueue[0];
    if (entry.signal?.aborted) { entry.abort(); continue; }
    if (activeSeparations >= entry.limit) return;
    separationQueue.shift();
    entry.settled = true;
    entry.signal?.removeEventListener('abort', entry.abort);
    activeSeparations += 1;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      activeSeparations = Math.max(0, activeSeparations - 1);
      pumpSeparationQueue();
    });
  }
}

function runCommand(command, args, { timeoutMs = 30_000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill?.('SIGKILL');
      reject(new Error('voiceover readiness process timed out'));
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function getManifestAndYaml(deps = {}) {
  const manifest = deps.manifest || await loadDemucsManifest(MANIFEST_PATH, deps);
  const yamlText = deps.yamlText ?? await (deps.readFile || readFile)(YAML_PATH, 'utf8');
  if (yamlText !== EXPECTED_YAML || manifest.model !== 'mdx_q') throw new Error('invalid model configuration');
  return manifest;
}

export async function checkVoiceoverSeparationReadiness({ env = process.env, deps = {} } = {}) {
  const config = getVoiceoverConfig(env);
  const runProcess = deps.runProcess || runCommand;
  const verifyModels = deps.verifyDemucsModelFiles || verifyDemucsModelFiles;
  let pythonReady = false;
  let modelReady = false;
  let ffmpegReady = false;
  try {
    if (config.separationPython) {
      const result = await runProcess(config.separationPython, ['-c', 'import importlib.metadata as m, torch, torchaudio; print("|".join((m.version("demucs"), m.version("torch"), m.version("torchaudio"))))']);
      pythonReady = (result?.exitCode ?? 1) === 0 && String(result?.stdout || '').trim() === '4.0.1|2.7.1+cpu|2.7.1+cpu';
    }
  } catch {}
  try {
    const manifest = await getManifestAndYaml(deps);
    const result = await verifyModels({ manifest, modelDir: config.demucsModelDir, deps });
    modelReady = result?.ready === true;
  } catch {}
  try {
    const result = await runProcess(String(env.MEIAO_FFMPEG_PATH || '').trim() || 'ffmpeg', ['-hide_banner', '-filters']);
    const output = String(result?.stdout || '');
    ffmpegReady = (result?.exitCode ?? 1) === 0 && REQUIRED_FILTERS.every((filter) => output.includes(filter));
  } catch {}
  const ready = pythonReady && modelReady && ffmpegReady;
  return Object.freeze({ ready, code: ready ? null : 'voiceover_separation_unavailable', pythonReady, modelReady, ffmpegReady });
}

function defaultKillProcessGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(-pid, signal); } catch {}
}

async function defaultProbeDurationMs(filePath, env, deps) {
  const ffprobePath = String(env.MEIAO_FFPROBE_PATH || '').trim() || 'ffprobe';
  const result = await runCommand(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { spawnProcess: deps.spawn || spawn });
  if ((result?.exitCode ?? 1) !== 0) throw new Error('duration probe failed');
  const seconds = Number(JSON.parse(String(result.stdout || '{}'))?.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('duration probe failed');
  return Math.round(seconds * 1000);
}

function waitForSeparationProcess({ pythonPath, args, signal, timeoutMs, deps }) {
  const spawnProcess = deps.spawn || spawn;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const killProcessGroup = deps.killProcessGroup || defaultKillProcessGroup;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child;
    try {
      child = spawnProcess(pythonPath, args, { shell: false, detached: true, stdio: 'ignore' });
    } catch {
      return reject(buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离不可用'));
    }
    let settled = false;
    let killTimer = null;
    let terminalError = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      if (killTimer) clearTimer(killTimer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const terminate = (error) => {
      if (terminalError) return;
      terminalError = error;
      killProcessGroup(child?.pid, 'SIGTERM');
      killTimer = setTimer(() => {
        killProcessGroup(child?.pid, 'SIGKILL');
        finish(reject, terminalError);
      }, 5_000);
      killTimer?.unref?.();
    };
    const onAbort = () => {
      terminate(abortError());
    };
    const timer = setTimer(() => {
      terminate(buildVoiceoverError('voiceover_separation_timeout', '本地人声分离超时'));
    }, timeoutMs);
    timer?.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once?.('error', () => finish(reject, terminalError || buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离不可用')));
    child.once?.('close', (exitCode) => {
      if (terminalError) finish(reject, terminalError);
      else if (exitCode === 0) finish(resolve, { exitCode: 0 });
      else finish(reject, buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离失败'));
    });
  });
}

async function validateOutput({ inputWavPath, vocalsPath, backgroundPath, durationToleranceMs, env, deps }) {
  const getStat = deps.stat || stat;
  const probe = deps.probeDurationMs || ((filePath) => defaultProbeDurationMs(filePath, env, deps));
  const [vocals, background] = await Promise.all([getStat(vocalsPath), getStat(backgroundPath)]);
  if (![vocals, background].every((file) => file?.size > 0 && (typeof file.isFile !== 'function' || file.isFile()))) {
    throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输出无效');
  }
  const [inputDurationMs, vocalsDurationMs, backgroundDurationMs] = await Promise.all([
    probe(inputWavPath), probe(vocalsPath), probe(backgroundPath),
  ]);
  if (![inputDurationMs, vocalsDurationMs, backgroundDurationMs].every((duration) => Number.isFinite(duration) && duration > 0)
    || Math.abs(vocalsDurationMs - inputDurationMs) > durationToleranceMs
    || Math.abs(backgroundDurationMs - inputDurationMs) > durationToleranceMs) {
    throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输出时长无效');
  }
  return inputDurationMs;
}

/**
 * `workDir` is an internal, server-created parent job directory. It is never derived from a
 * browser payload; callers without one receive a private mkdtemp directory. This function never
 * removes it because the parent persists both stems before owning cleanup.
 */
export async function separateVoiceover({ inputWavPath, workDir, signal, env = process.env, deps = {} } = {}) {
  const config = getVoiceoverConfig(env);
  const readiness = await (deps.checkReadiness || checkVoiceoverSeparationReadiness)({ env, deps });
  if (!readiness?.ready) throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离不可用');
  if (typeof inputWavPath !== 'string' || !inputWavPath) throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输入无效');
  const effectiveWorkDir = workDir || await (deps.mkdtemp || mkdtemp)(path.join(tmpdir(), 'meiao-voiceover-'));
  const outputDir = path.join(effectiveWorkDir, 'separated');
  const trackName = path.parse(inputWavPath).name;
  const stemDir = path.join(outputDir, 'mdx_q', trackName);
  const vocalsPath = path.join(stemDir, 'vocals.wav');
  const backgroundPath = path.join(stemDir, 'no_vocals.wav');
  const release = await acquireSeparationPermit(signal, config.separationConcurrency);
  try {
    await waitForSeparationProcess({
      pythonPath: config.separationPython,
      args: ['-m', 'demucs.separate', '-n', 'mdx_q', '-d', 'cpu', '-j', '1', '--two-stems=vocals', '--repo', config.demucsModelDir, '--out', outputDir, inputWavPath],
      signal, timeoutMs: config.separationTimeoutMs, deps,
    });
    const durationMs = await validateOutput({ inputWavPath, vocalsPath, backgroundPath, durationToleranceMs: config.durationToleranceMs, env, deps });
    return Object.freeze({ vocalsPath, backgroundPath, model: 'mdx_q', durationMs });
  } finally {
    release();
  }
}
