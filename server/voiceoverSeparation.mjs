import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVoiceoverError, getVoiceoverConfig } from './voiceoverContract.mjs';
import { resolvePackagedFfmpegPath, resolvePackagedFfprobePath } from './mediaTranscodeService.mjs';
import { runVoiceoverProcess } from './voiceoverAudio.mjs';
import { acquireVoiceoverHeavyProcessPermit } from './voiceoverHeavyProcessLimiter.mjs';
import { EXPECTED_MDX_YAML, loadDemucsManifest, verifyDemucsModelFiles } from '../scripts/install-voiceover-demucs.mjs';

const REQUIRED_FILTERS = Object.freeze(['sidechaincompress', 'amix', 'adelay', 'afade', 'atempo', 'alimiter']);
const MAX_READINESS_OUTPUT_BYTES = 64 * 1024;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(MODULE_DIR, '..', 'deploy', 'voiceover', 'demucs-models.json');
const YAML_PATH = path.join(MODULE_DIR, '..', 'deploy', 'voiceover', 'mdx.yaml');
const DEMUCS_ENV_ALLOWLIST = Object.freeze([
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TZ',
  'OMP_NUM_THREADS',
  'MKL_NUM_THREADS',
  'OPENBLAS_NUM_THREADS',
  'NUMEXPR_NUM_THREADS',
]);
const PINNED_PYTHON_RUNTIMES = Object.freeze({
  'linux|x86_64': Object.freeze(['4.0.1', '2.7.1+cpu', '2.7.1+cpu', '0.13.1', 'soundfile', 'WAV', '48000', '2', 'PCM_16', '4800']),
  'darwin|arm64': Object.freeze(['4.0.1', '2.7.1', '2.7.1', '0.13.1', 'soundfile', 'WAV', '48000', '2', 'PCM_16', '4800']),
});
const PYTHON_RUNTIME_PROBE = [
  'import importlib.metadata as m',
  'import os, platform, sys, tempfile',
  'import soundfile as sf',
  'import torch, torchaudio',
  'backends = torchaudio.list_audio_backends()',
  'if "soundfile" not in backends: raise RuntimeError("soundfile backend unavailable")',
  'descriptor, output_path = tempfile.mkstemp(suffix=".wav")',
  'os.close(descriptor)',
  'try:',
  '    samples = torch.zeros((2, 4800), dtype=torch.float32)',
  '    torchaudio.save(output_path, samples, 48000, encoding="PCM_S", bits_per_sample=16, backend="soundfile")',
  '    with sf.SoundFile(output_path) as audio:',
  '        wav_metadata = (audio.format, str(audio.samplerate), str(audio.channels), audio.subtype, str(audio.frames))',
  '    if wav_metadata != ("WAV", "48000", "2", "PCM_16", "4800"): raise RuntimeError("invalid WAV metadata")',
  'finally:',
  '    os.unlink(output_path)',
  'print("|".join((sys.platform, platform.machine().lower(), m.version("demucs"), m.version("torch"), m.version("torchaudio"), m.version("soundfile"), "soundfile", *wav_metadata)))',
].join('\n');

function buildDemucsProcessEnv(env, pythonPath, mediaExecutablePaths = []) {
  const executableDirs = [path.dirname(pythonPath)];
  for (const executablePath of mediaExecutablePaths) {
    if (!path.isAbsolute(executablePath)) continue;
    const executableDir = path.dirname(executablePath);
    if (!executableDirs.includes(executableDir)) executableDirs.push(executableDir);
  }
  const childEnv = {
    PATH: [...executableDirs, '/usr/bin', '/bin'].join(':'),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
  };
  for (const key of DEMUCS_ENV_ALLOWLIST) {
    const value = String(env?.[key] || '').trim();
    if (value) childEnv[key] = value;
  }
  return childEnv;
}

function abortError() {
  return Object.assign(new Error('voiceover separation cancelled'), { name: 'AbortError', code: 'voiceover_separation_cancelled' });
}

function isPinnedPythonRuntime(raw) {
  const [platform, arch, ...versions] = String(raw || '').trim().split('|');
  const expected = PINNED_PYTHON_RUNTIMES[`${platform}|${arch}`];
  return Boolean(expected)
    && versions.length === expected.length
    && versions.every((version, index) => version === expected[index]);
}

function runCommand(command, args, {
  timeoutMs = 30_000,
  spawnProcess = spawn,
  env,
  maxOutputBytes = MAX_READINESS_OUTPUT_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const appendOutput = (field, chunk) => {
      if (settled) return;
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        child.kill?.('SIGKILL');
        finish(reject, new Error('voiceover readiness process output exceeded limit'));
        return;
      }
      if (field === 'stdout') stdout += text;
      else stderr += text;
    };
    const timer = setTimeout(() => {
      child.kill?.('SIGKILL');
      finish(reject, new Error('voiceover readiness process timed out'));
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => appendOutput('stdout', chunk));
    child.stderr?.on('data', (chunk) => appendOutput('stderr', chunk));
    child.once('error', (error) => finish(reject, error));
    child.once('close', (exitCode) => {
      finish(resolve, { exitCode, stdout, stderr });
    });
  });
}

async function getManifestAndYaml(deps = {}) {
  const manifest = deps.manifest || await loadDemucsManifest(MANIFEST_PATH, deps);
  const yamlText = deps.yamlText ?? await (deps.readFile || readFile)(YAML_PATH, 'utf8');
  if (yamlText !== EXPECTED_MDX_YAML || manifest.model !== 'mdx') throw new Error('invalid model configuration');
  return manifest;
}

export async function checkVoiceoverSeparationReadiness({
  env = process.env,
  config: providedConfig,
  verifyModelLoad = true,
  deps = {},
} = {}) {
  const config = providedConfig || getVoiceoverConfig(env);
  const runProcess = deps.runProcess || runCommand;
  const verifyModels = deps.verifyDemucsModelFiles || verifyDemucsModelFiles;
  let pythonReady = false;
  let modelReady = false;
  let ffmpegReady = false;
  try {
    if (config.separationPython) {
      const result = await runProcess(
        config.separationPython,
        ['-c', PYTHON_RUNTIME_PROBE],
        { env: buildDemucsProcessEnv(env, config.separationPython) },
      );
      pythonReady = (result?.exitCode ?? 1) === 0 && isPinnedPythonRuntime(result?.stdout);
    }
  } catch {}
  try {
    const manifest = await getManifestAndYaml(deps);
    const result = await verifyModels({ manifest, modelDir: config.demucsModelDir, deps });
    const runtimeYaml = await (deps.readFile || readFile)(path.join(config.demucsModelDir, 'mdx.yaml'), 'utf8');
    const modelFilesReady = result?.ready === true && runtimeYaml === EXPECTED_MDX_YAML;
    if (modelFilesReady && !verifyModelLoad) {
      modelReady = true;
    } else if (modelFilesReady && config.separationPython) {
      const loadResult = await runProcess(
        config.separationPython,
        ['-c', 'import sys; from pathlib import Path; from demucs.pretrained import get_model; get_model("mdx", Path(sys.argv[1])); print("mdx-load-ok")', config.demucsModelDir],
        {
          env: buildDemucsProcessEnv(env, config.separationPython),
          timeoutMs: config.readinessModelTimeoutMs,
        },
      );
      modelReady = (loadResult?.exitCode ?? 1) === 0 && String(loadResult?.stdout || '').trim() === 'mdx-load-ok';
    }
  } catch {}
  try {
    const ffmpegPath = String(env.MEIAO_FFMPEG_PATH || '').trim() || (deps.resolveFfmpegPath || resolvePackagedFfmpegPath)();
    if (!ffmpegPath) throw new Error('packaged ffmpeg unavailable');
    const result = await runProcess(ffmpegPath, ['-hide_banner', '-filters']);
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
  const ffprobePath = String(env.MEIAO_FFPROBE_PATH || '').trim() || (deps.resolveFfprobePath || resolvePackagedFfprobePath)();
  if (!ffprobePath) throw new Error('packaged ffprobe unavailable');
  const result = await runCommand(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { spawnProcess: deps.spawn || spawn });
  if ((result?.exitCode ?? 1) !== 0) throw new Error('duration probe failed');
  const seconds = Number(JSON.parse(String(result.stdout || '{}'))?.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('duration probe failed');
  return Math.round(seconds * 1000);
}

export function buildNormalizeDemucsStemArgs(inputPath, outputPath) {
  if (
    typeof inputPath !== 'string'
    || typeof outputPath !== 'string'
    || !path.isAbsolute(inputPath)
    || !path.isAbsolute(outputPath)
    || inputPath === outputPath
  ) {
    throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输出路径无效');
  }
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    outputPath,
  ];
}

async function normalizeDemucsStem({
  inputPath,
  outputPath,
  signal,
  timeoutMs,
  env,
  deps,
}) {
  const ffmpegPath = String(env.MEIAO_FFMPEG_PATH || '').trim()
    || (deps.resolveFfmpegPath || resolvePackagedFfmpegPath)();
  if (!ffmpegPath || !path.isAbsolute(ffmpegPath)) {
    throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输出标准化不可用');
  }
  const runMediaProcess = deps.runMediaProcess || runVoiceoverProcess;
  try {
    await runMediaProcess(
      ffmpegPath,
      buildNormalizeDemucsStemArgs(inputPath, outputPath),
      {
        signal,
        timeoutMs,
        ...(deps.spawnMedia ? { spawnImpl: deps.spawnMedia } : {}),
      },
    );
  } catch (error) {
    if (error?.releasePermitWhenClosed) {
      const wrapped = buildVoiceoverError(
        'voiceover_separation_unavailable',
        '本地人声分离输出标准化失败',
      );
      Object.defineProperty(wrapped, 'releasePermitWhenClosed', {
        value: error.releasePermitWhenClosed,
        enumerable: false,
      });
      throw wrapped;
    }
    throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输出标准化失败');
  }
  return outputPath;
}

function waitForSeparationProcess({
  pythonPath,
  args,
  signal,
  timeoutMs,
  deps,
  env,
}) {
  const spawnProcess = deps.spawn || spawn;
  const ffmpegPath = String(env.MEIAO_FFMPEG_PATH || '').trim()
    || (deps.resolveFfmpegPath || resolvePackagedFfmpegPath)();
  const ffprobePath = String(env.MEIAO_FFPROBE_PATH || '').trim()
    || (deps.resolveFfprobePath || resolvePackagedFfprobePath)();
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const killProcessGroup = deps.killProcessGroup || defaultKillProcessGroup;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child;
    try {
      child = spawnProcess(pythonPath, args, {
        shell: false,
        detached: true,
        stdio: 'ignore',
        env: buildDemucsProcessEnv(env, pythonPath, [ffmpegPath, ffprobePath]),
      });
    } catch {
      return reject(buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离不可用'));
    }
    let settled = false;
    let killTimer = null;
    let closeTimer = null;
    let terminalError = null;
    let resolveClosed;
    const closed = new Promise((resolve) => { resolveClosed = resolve; });
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      if (killTimer) clearTimer(killTimer);
      if (closeTimer) clearTimer(closeTimer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const terminate = (error) => {
      if (terminalError) return;
      terminalError = error;
      try { killProcessGroup(child?.pid, 'SIGTERM'); } catch {}
      killTimer = setTimer(() => {
        try { killProcessGroup(child?.pid, 'SIGKILL'); } catch {}
        closeTimer = setTimer(() => {
          if (settled) return;
          Object.defineProperty(terminalError, 'releasePermitWhenClosed', { value: closed, enumerable: false });
          finish(reject, terminalError);
        }, 5_000);
        closeTimer?.unref?.();
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
      resolveClosed();
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
 * browser payload. For a private directory created here, the returned `cleanupWorkDir` transfers
 * ownership to the caller after persistence; failures and cancellations remove it immediately.
 */
export async function separateVoiceover({
  inputWavPath,
  workDir,
  signal,
  env = process.env,
  config: providedConfig,
  deps = {},
} = {}) {
  const config = providedConfig || getVoiceoverConfig(env);
  if (typeof inputWavPath !== 'string' || !inputWavPath) throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离输入无效');
  const acquirePermit = deps.acquireHeavyProcessPermit
    || acquireVoiceoverHeavyProcessPermit;
  const release = await acquirePermit(signal, config.separationConcurrency);
  let effectiveWorkDir = workDir;
  const ownsWorkDir = !workDir;
  const cleanup = deps.rm || rm;
  let releaseAfterClose = null;
  try {
    const readiness = await (deps.checkReadiness || checkVoiceoverSeparationReadiness)({
      env,
      config,
      verifyModelLoad: false,
      deps,
    });
    if (!readiness?.ready) throw buildVoiceoverError('voiceover_separation_unavailable', '本地人声分离不可用');
    if (ownsWorkDir) effectiveWorkDir = await (deps.mkdtemp || mkdtemp)(path.join(tmpdir(), 'meiao-voiceover-'));
    const outputDir = path.join(effectiveWorkDir, 'separated');
    const trackName = path.parse(inputWavPath).name;
    const stemDir = path.join(outputDir, 'mdx', trackName);
    const rawVocalsPath = path.join(stemDir, 'vocals.wav');
    const rawBackgroundPath = path.join(stemDir, 'no_vocals.wav');
    const vocalsPath = path.join(stemDir, 'vocals.pcm.wav');
    const backgroundPath = path.join(stemDir, 'no_vocals.pcm.wav');
    await waitForSeparationProcess({
      pythonPath: config.separationPython,
      args: ['-m', 'demucs.separate', '-n', 'mdx', '-d', 'cpu', '-j', '1', '--two-stems=vocals', '--repo', config.demucsModelDir, '--out', outputDir, inputWavPath],
      signal, timeoutMs: config.separationTimeoutMs, deps,
      env,
    });
    const normalizeStem = deps.normalizeStem || normalizeDemucsStem;
    await normalizeStem({
      inputPath: rawVocalsPath,
      outputPath: vocalsPath,
      signal,
      timeoutMs: config.separationTimeoutMs,
      env,
      deps,
    });
    await normalizeStem({
      inputPath: rawBackgroundPath,
      outputPath: backgroundPath,
      signal,
      timeoutMs: config.separationTimeoutMs,
      env,
      deps,
    });
    const durationMs = await validateOutput({ inputWavPath, vocalsPath, backgroundPath, durationToleranceMs: config.durationToleranceMs, env, deps });
    return Object.freeze({ vocalsPath, backgroundPath, model: 'mdx', durationMs,
      ...(ownsWorkDir ? { cleanupWorkDir: () => cleanup(effectiveWorkDir, { recursive: true, force: true }) } : {}), });
  } catch (error) {
    if (error?.releasePermitWhenClosed) {
      releaseAfterClose = error.releasePermitWhenClosed.then(async () => {
        if (ownsWorkDir && effectiveWorkDir) await cleanup(effectiveWorkDir, { recursive: true, force: true }).catch(() => {});
        release();
      });
    } else if (ownsWorkDir && effectiveWorkDir) {
      await cleanup(effectiveWorkDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (!releaseAfterClose) release();
  }
}
