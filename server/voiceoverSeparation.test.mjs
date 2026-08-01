import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildNormalizeDemucsStemArgs,
  checkVoiceoverSeparationReadiness,
  separateVoiceover,
} from './voiceoverSeparation.mjs';
import { resolvePackagedFfprobePath } from './mediaTranscodeService.mjs';

const manifest = { schemaVersion: 1, model: 'mdx', files: [{ name: 'model.th', size: 4, sha256: 'a'.repeat(64), url: 'https://example.invalid/model.th' }] };
const mdxYaml = `models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;
const linuxRuntimeProbe = 'linux|x86_64|4.0.1|2.7.1+cpu|2.7.1+cpu|0.13.1|soundfile|WAV|48000|2|PCM_16|4800\n';
const darwinRuntimeProbe = 'darwin|arm64|4.0.1|2.7.1|2.7.1|0.13.1|soundfile|WAV|48000|2|PCM_16|4800\n';

const completeEnv = (extra = {}) => ({
  MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
  MEIAO_VOICEOVER_SEPARATION_PYTHON: '/configured/venv/bin/python',
  MEIAO_VOICEOVER_DEMUCS_MODEL_DIR: '/configured/models',
  MEIAO_FFMPEG_PATH: '/configured/ffmpeg',
  MEIAO_VOICEOVER_SEPARATION_TIMEOUT_MS: '300000',
  ...extra,
});

const readyDeps = (extra = {}) => ({
  manifest,
  yamlText: mdxYaml,
  readFile: async () => mdxYaml,
  verifyDemucsModelFiles: async () => ({ ready: true, files: [] }),
  runProcess: async (_command, args) => args.includes('-filters')
      ? { exitCode: 0, stdout: ' ... sidechaincompress ... amix ... adelay ... afade ... atempo ... alimiter ... ' }
      : args[0] === '-c' && args[1].includes('demucs.pretrained')
        ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
      : { exitCode: 0, stdout: linuxRuntimeProbe },
  normalizeStem: async ({ outputPath }) => outputPath,
  ...extra,
});

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function pinnedFixtureVersions() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { demucs: '4.0.1', torch: '2.7.1', torchaudio: '2.7.1', soundfile: '0.13.1' };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { demucs: '4.0.1', torch: '2.7.1+cpu', torchaudio: '2.7.1+cpu', soundfile: '0.13.1' };
  }
  throw new Error(`unsupported voiceover test runtime: ${process.platform}/${process.arch}`);
}

async function createPythonRuntimeFixture({
  includeSoundfile = true,
  backends = ['soundfile'],
  failWrite = false,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-python-runtime-'));
  const moduleDir = path.join(root, 'modules');
  const pythonPath = path.join(root, 'fixture-python');
  const ffmpegPath = path.join(root, 'fixture-ffmpeg');
  const metadataPath = path.join(root, 'wav-metadata.txt');
  const versions = pinnedFixtureVersions();
  await mkdir(moduleDir, { recursive: true });
  for (const [name, version] of Object.entries(versions)) {
    if (name === 'soundfile' && !includeSoundfile) continue;
    const distInfo = path.join(moduleDir, `${name}-0.dist-info`);
    await mkdir(distInfo, { recursive: true });
    await writeFile(path.join(distInfo, 'METADATA'), `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`);
  }
  await writeFile(path.join(moduleDir, 'torch.py'), `
float32 = "float32"
def zeros(shape, dtype=None):
    return {"shape": shape, "dtype": dtype}
`);
  await writeFile(path.join(moduleDir, 'torchaudio.py'), `
import wave
BACKENDS = ${JSON.stringify(backends)}
FAIL_WRITE = ${failWrite ? 'True' : 'False'}
def list_audio_backends():
    return list(BACKENDS)
def save(uri, src, sample_rate, channels_first=True, format=None, encoding=None, bits_per_sample=None, buffer_size=4096, backend=None, compression=None):
    if FAIL_WRITE:
        raise RuntimeError("fixture write failure")
    if backend != "soundfile" or sample_rate != 48000 or encoding != "PCM_S" or bits_per_sample != 16:
        raise RuntimeError("invalid save contract")
    with wave.open(uri, "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\\x00\\x00" * 2 * 4800)
`);
  if (includeSoundfile) {
    await writeFile(path.join(moduleDir, 'soundfile.py'), `
import wave
class SoundFile:
    def __init__(self, file_path):
        self._input = wave.open(file_path, "rb")
        self.channels = self._input.getnchannels()
        self.samplerate = self._input.getframerate()
        self.frames = self._input.getnframes()
        self.format = "WAV"
        self.subtype = "PCM_16" if self._input.getsampwidth() == 2 else "UNKNOWN"
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, traceback):
        self._input.close()
        with open(${JSON.stringify(metadataPath)}, "w", encoding="utf-8") as marker:
            marker.write(f"{self.samplerate}|{self.channels}|{self.subtype}|{self.frames}")
`);
  }
  await writeFile(pythonPath, `#!/usr/bin/env python3
import sys
fixture_root = ${JSON.stringify(moduleDir)}
sys.path[:] = [fixture_root] + [
    entry for entry in sys.path
    if entry and "site-packages" not in entry and "dist-packages" not in entry
]
if len(sys.argv) < 3 or sys.argv[1] != "-c":
    raise SystemExit(2)
exec(compile(sys.argv[2], "<fixture-python>", "exec"), {"__name__": "__main__"})
`);
  await writeFile(ffmpegPath, '#!/bin/sh\nprintf "sidechaincompress amix adelay afade atempo alimiter\\n"\n');
  await chmod(pythonPath, 0o755);
  await chmod(ffmpegPath, 0o755);
  return {
    root,
    pythonPath,
    ffmpegPath,
    metadataPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function runRealPythonReadiness(fixture) {
  return checkVoiceoverSeparationReadiness({
    env: completeEnv({
      MEIAO_VOICEOVER_SEPARATION_PYTHON: fixture.pythonPath,
      MEIAO_FFMPEG_PATH: fixture.ffmpegPath,
    }),
    verifyModelLoad: false,
    deps: {
      manifest,
      yamlText: mdxYaml,
      readFile: async () => mdxYaml,
      verifyDemucsModelFiles: async () => ({ ready: true, files: [] }),
    },
  });
}

test('normalizes Demucs stems to the canonical 48 kHz stereo PCM work-track contract', () => {
  assert.deepEqual(
    buildNormalizeDemucsStemArgs('/tmp/raw vocals.wav', '/tmp/canonical vocals.wav'),
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', '/tmp/raw vocals.wav',
      '-map', '0:a:0',
      '-vn',
      '-ac', '2',
      '-ar', '48000',
      '-c:a', 'pcm_s16le',
      '/tmp/canonical vocals.wav',
    ],
  );
  assert.throws(
    () => buildNormalizeDemucsStemArgs('/tmp/same.wav', '/tmp/same.wav'),
    (error) => error?.code === 'voiceover_separation_unavailable',
  );
});

test('returns normalized stem paths and preserves the raw Demucs outputs as internal intermediates', async () => {
  const child = fakeChild();
  const calls = [];
  const result = await separateVoiceover({
    inputWavPath: '/tmp/input.wav',
    workDir: '/tmp/normalized-job',
    env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }),
      spawn: () => {
        queueMicrotask(() => child.emit('close', 0));
        return child;
      },
      normalizeStem: async (options) => {
        calls.push(options);
        return options.outputPath;
      },
      stat: async () => ({ size: 10 }),
      probeDurationMs: async () => 1_000,
    }),
  });

  assert.deepEqual(calls.map(({ inputPath, outputPath }) => ({ inputPath, outputPath })), [
    {
      inputPath: '/tmp/normalized-job/separated/mdx/input/vocals.wav',
      outputPath: '/tmp/normalized-job/separated/mdx/input/vocals.pcm.wav',
    },
    {
      inputPath: '/tmp/normalized-job/separated/mdx/input/no_vocals.wav',
      outputPath: '/tmp/normalized-job/separated/mdx/input/no_vocals.pcm.wav',
    },
  ]);
  assert.equal(result.vocalsPath, '/tmp/normalized-job/separated/mdx/input/vocals.pcm.wav');
  assert.equal(result.backgroundPath, '/tmp/normalized-job/separated/mdx/input/no_vocals.pcm.wav');
});

test('runtime readiness fails closed on one mismatched model hash', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ verifyDemucsModelFiles: async () => ({ ready: false, files: [{ name: 'model.th', ready: false }] }) }),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.modelReady, false);
  assert.equal(readiness.code, 'voiceover_separation_unavailable');
});

test('runtime readiness accepts the pinned macOS arm64 package versions', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({
      runProcess: async (_command, args) => args.includes('-filters')
        ? { exitCode: 0, stdout: ' ... sidechaincompress ... amix ... adelay ... afade ... atempo ... alimiter ... ' }
        : args[0] === '-c' && args[1].includes('demucs.pretrained')
          ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
          : { exitCode: 0, stdout: darwinRuntimeProbe },
    }),
  });
  assert.deepEqual(readiness, {
    ready: true,
    code: null,
    pythonReady: true,
    modelReady: true,
    ffmpegReady: true,
  });
});

test('runtime readiness rejects macOS arm64 without the pinned soundfile backend', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({
      runProcess: async (_command, args) => args.includes('-filters')
        ? { exitCode: 0, stdout: ' ... sidechaincompress ... amix ... adelay ... afade ... atempo ... alimiter ... ' }
        : args[0] === '-c' && args[1].includes('demucs.pretrained')
          ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
          : { exitCode: 0, stdout: 'darwin|arm64|4.0.1|2.7.1|2.7.1|missing|missing\n' },
    }),
  });
  assert.equal(readiness.pythonReady, false);
  assert.equal(readiness.ready, false);
});

test('runtime readiness rejects Linux without the pinned soundfile audio backend', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({
      runProcess: async (_command, args) => args.includes('-filters')
        ? { exitCode: 0, stdout: ' ... sidechaincompress ... amix ... adelay ... afade ... atempo ... alimiter ... ' }
        : args[0] === '-c' && args[1].includes('demucs.pretrained')
          ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
          : { exitCode: 0, stdout: 'linux|x86_64|4.0.1|2.7.1+cpu|2.7.1+cpu|missing|missing\n' },
    }),
  });
  assert.equal(readiness.pythonReady, false);
  assert.equal(readiness.ready, false);
});

test('runtime readiness uses a real Python subprocess to reject a missing SoundFile package', async () => {
  const fixture = await createPythonRuntimeFixture({ includeSoundfile: false });
  try {
    const readiness = await runRealPythonReadiness(fixture);
    assert.equal(readiness.pythonReady, false);
    assert.equal(readiness.ready, false);
  } finally {
    await fixture.cleanup();
  }
});

test('runtime readiness uses a real Python subprocess to reject a missing SoundFile backend', async () => {
  const fixture = await createPythonRuntimeFixture({ backends: [] });
  try {
    const readiness = await runRealPythonReadiness(fixture);
    assert.equal(readiness.pythonReady, false);
    assert.equal(readiness.ready, false);
  } finally {
    await fixture.cleanup();
  }
});

test('runtime readiness rejects an advertised SoundFile backend that cannot write WAV', async () => {
  const fixture = await createPythonRuntimeFixture({ failWrite: true });
  try {
    const readiness = await runRealPythonReadiness(fixture);
    assert.equal(readiness.pythonReady, false);
    assert.equal(readiness.ready, false);
  } finally {
    await fixture.cleanup();
  }
});

test('runtime readiness writes and inspects a real 48 kHz stereo PCM WAV in a Python subprocess', async () => {
  const fixture = await createPythonRuntimeFixture();
  try {
    const readiness = await runRealPythonReadiness(fixture);
    assert.equal(readiness.pythonReady, true);
    assert.equal(readiness.ready, true);
    assert.equal(await readFile(fixture.metadataPath, 'utf8'), '48000|2|PCM_16|4800');
  } finally {
    await fixture.cleanup();
  }
});

test('runtime readiness rejects malformed Python probe output', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    verifyModelLoad: false,
    deps: readyDeps({
      runProcess: async (_command, args) => args.includes('-filters')
        ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
        : { exitCode: 0, stdout: 'linux|x86_64|malformed\n' },
    }),
  });
  assert.equal(readiness.pythonReady, false);
  assert.equal(readiness.ready, false);
});

test('runtime readiness kills a Python probe before oversized output can continue', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-python-overflow-'));
  const pythonPath = path.join(root, 'fixture-python');
  const ffmpegPath = path.join(root, 'fixture-ffmpeg');
  const markerPath = path.join(root, 'continued-after-overflow');
  await writeFile(pythonPath, `#!/usr/bin/env python3
import sys
import time
sys.stdout.write("x" * 70000)
sys.stdout.flush()
time.sleep(0.25)
with open(${JSON.stringify(markerPath)}, "w", encoding="utf-8") as marker:
    marker.write("continued")
`);
  await writeFile(ffmpegPath, '#!/bin/sh\nprintf "sidechaincompress amix adelay afade atempo alimiter\\n"\n');
  await chmod(pythonPath, 0o755);
  await chmod(ffmpegPath, 0o755);
  try {
    const readiness = await checkVoiceoverSeparationReadiness({
      env: completeEnv({
        MEIAO_VOICEOVER_SEPARATION_PYTHON: pythonPath,
        MEIAO_FFMPEG_PATH: ffmpegPath,
      }),
      verifyModelLoad: false,
      deps: {
        manifest,
        yamlText: mdxYaml,
        readFile: async () => mdxYaml,
        verifyDemucsModelFiles: async () => ({ ready: true, files: [] }),
      },
    });
    assert.equal(readiness.pythonReady, false);
    await assert.rejects(access(markerPath), (error) => error?.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('separation propagates the parent normalized config snapshot to readiness', async () => {
  const config = Object.freeze({
    separationPython: '/snapshot/python',
    demucsModelDir: '/snapshot/models',
    separationConcurrency: 1,
    separationTimeoutMs: 123_456,
    durationToleranceMs: 77,
  });
  const sentinel = Object.assign(new Error('stop after capture'), { code: 'capture' });

  await assert.rejects(
    separateVoiceover({
      inputWavPath: '/tmp/input.wav',
      workDir: '/tmp/work',
      env: completeEnv(),
      config,
      deps: {
        checkReadiness: async (options) => {
          assert.equal(options.config, config);
          assert.equal(options.verifyModelLoad, false);
          throw sentinel;
        },
      },
    }),
    (error) => error === sentinel,
  );
});

test('readiness validates Python imports, the exact Demucs version, and required FFmpeg filters without leaking paths', async () => {
  const calls = [];
  const env = completeEnv({
    KIE_API_KEY: 'must-not-reach-demucs',
    MEIAO_DB_PASSWORD: 'must-not-reach-demucs-either',
    TORCH_FORCE_WEIGHTS_ONLY_LOAD: '1',
    TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '0',
  });
  const readiness = await checkVoiceoverSeparationReadiness({
    env,
    deps: readyDeps({ runProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return args.includes('-filters')
        ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
        : args[1].includes('demucs.pretrained') ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
        : { exitCode: 0, stdout: linuxRuntimeProbe };
    } }),
  });
  assert.deepEqual(readiness, { ready: true, code: null, pythonReady: true, modelReady: true, ffmpegReady: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].args[0], '-c');
  assert.match(calls[0].args[1], /torchaudio\.list_audio_backends/);
  assert.match(calls[0].args[1], /torchaudio\.save/);
  assert.match(calls[0].args[1], /sf\.SoundFile/);
  assert.deepEqual(calls[1].args, [
    '-c',
    'import sys; from pathlib import Path; from demucs.pretrained import get_model; get_model("mdx", Path(sys.argv[1])); print("mdx-load-ok")',
    '/configured/models',
  ]);
  assert.deepEqual(calls[2].args, ['-hide_banner', '-filters']);
  for (const call of calls.filter(({ command }) => command === '/configured/venv/bin/python')) {
    assert.equal(call.options.env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, '1');
    assert.equal('TORCH_FORCE_WEIGHTS_ONLY_LOAD' in call.options.env, false);
    assert.equal('KIE_API_KEY' in call.options.env, false);
    assert.equal('MEIAO_DB_PASSWORD' in call.options.env, false);
  }
  assert.equal(calls[1].options.timeoutMs, 120_000);
  assert.equal(env.TORCH_FORCE_WEIGHTS_ONLY_LOAD, '1');
  assert.equal(env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, '0');
  assert.doesNotMatch(JSON.stringify(readiness), /\/configured\/|secret|token|https?:/i);
});

test('runtime health verifies pinned files without allocating the Demucs model a second time', async () => {
  const calls = [];
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    verifyModelLoad: false,
    deps: readyDeps({
      runProcess: async (_command, args, options) => {
        calls.push({ args, options });
        return args.includes('-filters')
          ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
          : { exitCode: 0, stdout: linuxRuntimeProbe };
      },
    }),
  });

  assert.equal(readiness.ready, true);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(({ args }) => args.some((arg) => String(arg).includes('demucs.pretrained'))), false);
});

test('readiness load gate uses the Demucs v4.0.1 public get_model API with modelDir argv', async () => {
  const source = await readFile(new URL('./voiceoverSeparation.mjs', import.meta.url), 'utf8');
  assert.match(source, /from demucs\.pretrained import get_model/);
  assert.match(source, /Path\(sys\.argv\[1\]\)/);
  assert.doesNotMatch(source, /LocalRepo\([^)]*\)\.get_model/);
});

test('readiness never downloads models or packages', async () => {
  let downloads = 0;
  await checkVoiceoverSeparationReadiness({ env: completeEnv(), deps: readyDeps({ downloadToFile: async () => { downloads += 1; } }) });
  assert.equal(downloads, 0);
});

test('readiness fails closed when package versions or FFmpeg filters drift', async () => {
  const versionDrift = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ runProcess: async (_command, args) => args.includes('-filters')
      ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
      : args[1].includes('demucs.pretrained') ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
      : { exitCode: 0, stdout: 'linux|x86_64|4.0.1|2.7.1|2.7.1|0.13.1|soundfile|WAV|48000|2|PCM_16|4800\n' } }),
  });
  assert.deepEqual(versionDrift, { ready: false, code: 'voiceover_separation_unavailable', pythonReady: false, modelReady: true, ffmpegReady: true });
  const filterDrift = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ runProcess: async (_command, args) => args.includes('-filters')
      ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo' }
      : args[1].includes('demucs.pretrained') ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
      : { exitCode: 0, stdout: linuxRuntimeProbe } }),
  });
  assert.deepEqual(filterDrift, { ready: false, code: 'voiceover_separation_unavailable', pythonReady: true, modelReady: true, ffmpegReady: false });
});

test('readiness requires the installed mdx.yaml and the local Demucs load gate', async () => {
  const missingYaml = await checkVoiceoverSeparationReadiness({
    env: completeEnv(), deps: readyDeps({ readFile: async () => 'models: []\n' }),
  });
  assert.equal(missingYaml.modelReady, false);
  const badLoad = await checkVoiceoverSeparationReadiness({
    env: completeEnv(), deps: readyDeps({ runProcess: async (_command, args) => args.includes('-filters')
      ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
      : args[1].includes('demucs.pretrained') ? { exitCode: 1, stdout: '' }
      : { exitCode: 0, stdout: linuxRuntimeProbe } }),
  });
  assert.equal(badLoad.modelReady, false);
});

test('readiness uses the packaged FFmpeg resolver when the environment has no override', async () => {
  const calls = [];
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv({ MEIAO_FFMPEG_PATH: '' }),
    deps: readyDeps({
      resolveFfmpegPath: () => '/packaged/ffmpeg',
      runProcess: async (command, args) => {
        calls.push(command);
        return args.includes('-filters') ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
          : args[1].includes('demucs.pretrained') ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
          : { exitCode: 0, stdout: linuxRuntimeProbe };
      },
    }),
  });
  assert.equal(readiness.ffmpegReady, true);
  assert.ok(calls.includes('/packaged/ffmpeg'));
  assert.equal(calls.includes('ffmpeg'), false);
});

test('voiceover uses the packaged FFprobe resolver with structured duration arguments', async () => {
  const calls = [];
  const separationChild = fakeChild();
  const packagedFfprobePath = resolvePackagedFfprobePath();
  assert.equal(typeof packagedFfprobePath, 'string');
  const pending = separateVoiceover({
    inputWavPath: '/tmp/input.wav', workDir: '/tmp/ffprobe-job', env: completeEnv({ MEIAO_FFPROBE_PATH: '' }),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }),
      stat: async () => ({ size: 10 }),
      spawn: (command, args) => {
        calls.push({ command, args });
        if (command === '/configured/venv/bin/python') {
          queueMicrotask(() => separationChild.emit('close', 0));
          return separationChild;
        }
        const child = fakeChild();
        queueMicrotask(() => {
          child.stdout.emit('data', '{"format":{"duration":"1.0"}}');
          child.emit('close', 0);
        });
        return child;
      },
    }),
  });
  await pending;
  const probes = calls.filter((call) => call.command === packagedFfprobePath);
  assert.equal(probes.length, 3);
  assert.deepEqual(probes.map((call) => call.args.slice(0, 6)), [
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json'],
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json'],
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json'],
  ]);
});

test('spawns mdx cpu two-stem separation without a shell', async () => {
  const calls = [];
  const child = fakeChild();
  const env = completeEnv({
    MEIAO_FFMPEG_PATH: '/configured/ffmpeg/bin/ffmpeg',
    MEIAO_FFPROBE_PATH: '/configured/ffprobe/bin/ffprobe',
    KIE_API_KEY: 'must-not-reach-demucs',
    MEIAO_DB_PASSWORD: 'must-not-reach-demucs-either',
    TORCH_FORCE_WEIGHTS_ONLY_LOAD: '1',
    TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '0',
  });
  const pending = separateVoiceover({
    inputWavPath: '/tmp/input with $(touch nope).wav', workDir: '/tmp/job-1',
    env,
    deps: readyDeps({
      spawn: (command, args, options) => { calls.push({ command, args, options }); queueMicrotask(() => child.emit('close', 0)); return child; },
      stat: async () => ({ size: 10 }),
      probeDurationMs: async () => 1000,
      checkReadiness: async () => ({ ready: true }),
    }),
  });
  const result = await pending;
  assert.deepEqual(calls[0].args, [
    '-m', 'demucs.separate', '-n', 'mdx', '-d', 'cpu', '-j', '1', '--two-stems=vocals',
    '--repo', '/configured/models', '--out', '/tmp/job-1/separated', '/tmp/input with $(touch nope).wav',
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.deepEqual(calls[0].options.env.PATH.split(':'), [
    '/configured/venv/bin', '/configured/ffmpeg/bin', '/configured/ffprobe/bin', '/usr/bin', '/bin',
  ]);
  assert.equal(calls[0].options.env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, '1');
  assert.equal('TORCH_FORCE_WEIGHTS_ONLY_LOAD' in calls[0].options.env, false);
  assert.equal('KIE_API_KEY' in calls[0].options.env, false);
  assert.equal('MEIAO_DB_PASSWORD' in calls[0].options.env, false);
  assert.equal(env.TORCH_FORCE_WEIGHTS_ONLY_LOAD, '1');
  assert.equal(env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, '0');
  assert.deepEqual(result, {
    vocalsPath: '/tmp/job-1/separated/mdx/input with $(touch nope)/vocals.pcm.wav',
    backgroundPath: '/tmp/job-1/separated/mdx/input with $(touch nope)/no_vocals.pcm.wav', model: 'mdx', durationMs: 1000,
  });
});

test('global queue is FIFO and keeps the configured concurrency bound', async () => {
  const children = [];
  const calls = [];
  let readinessCalls = 0;
  const deps = readyDeps({
    checkReadiness: async () => { readinessCalls += 1; return { ready: true }; },
    stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
    spawn: (...args) => { calls.push(args); const child = fakeChild(); children.push(child); return child; },
  });
  const first = separateVoiceover({ inputWavPath: '/tmp/first.wav', workDir: '/tmp/first', env: completeEnv(), deps });
  const second = separateVoiceover({ inputWavPath: '/tmp/second.wav', workDir: '/tmp/second', env: completeEnv(), deps });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(readinessCalls, 1);
  children[0].emit('close', 0);
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(readinessCalls, 2);
  children[1].emit('close', 0);
  await second;
});

test('abort does not release until the detached process group closes after termination', async () => {
  const controller = new AbortController();
  const signals = [];
  const child = fakeChild();
  const pending = separateVoiceover({
    inputWavPath: '/tmp/input.wav', workDir: '/tmp/job-abort', signal: controller.signal, env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }), spawn: () => child,
      killProcessGroup: (_pid, signal) => signals.push(signal),
      setTimeout: (callback, delay) => { if (delay === 5_000) queueMicrotask(callback); return { unref() {} }; }, clearTimeout: () => {},
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  child.emit('close', null);
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('FIFO permit stays occupied until an aborted process group reaches bounded kill completion', async () => {
  const controller = new AbortController();
  const children = [fakeChild(), fakeChild()];
  const calls = [];
  const timers = [];
  const first = separateVoiceover({
    inputWavPath: '/tmp/first.wav', workDir: '/tmp/first', signal: controller.signal, env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }), stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
      spawn: (...args) => { calls.push(args); return children[calls.length - 1]; },
      killProcessGroup: () => {}, setTimeout: (callback, delay) => { timers.push({ callback, delay }); return { unref() {} }; }, clearTimeout: () => {},
    }),
  });
  first.catch(() => {});
  const second = separateVoiceover({
    inputWavPath: '/tmp/second.wav', workDir: '/tmp/second', env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }), stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
      spawn: (...args) => { calls.push(args); return children[calls.length - 1]; },
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return { unref() {} }; }, clearTimeout: () => {},
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  timers.find((timer) => timer.delay === 5_000).callback();
  children[0].emit('close', null);
  await assert.rejects(first, (error) => error?.name === 'AbortError');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  children[1].emit('close', 0);
  await second;
});

test('close timeout rejects the caller but poisons the permit until the child actually closes', async () => {
  const controller = new AbortController();
  const children = [fakeChild(), fakeChild()];
  const calls = [];
  const timers = [];
  const deps = readyDeps({
    checkReadiness: async () => ({ ready: true }), stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
    spawn: (...args) => { calls.push(args); return children[calls.length - 1]; },
    killProcessGroup: () => {}, setTimeout: (callback, delay) => { timers.push({ callback, delay }); return { unref() {} }; }, clearTimeout: () => {},
  });
  const first = separateVoiceover({ inputWavPath: '/tmp/poison-first.wav', workDir: '/tmp/poison-first', signal: controller.signal, env: completeEnv(), deps });
  first.catch(() => {});
  const second = separateVoiceover({ inputWavPath: '/tmp/poison-second.wav', workDir: '/tmp/poison-second', env: completeEnv(), deps });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const killGrace = timers.filter((timer) => timer.delay === 5_000)[0];
  killGrace.callback();
  const closeTimeout = timers.filter((timer) => timer.delay === 5_000)[1];
  closeTimeout.callback();
  await assert.rejects(first, (error) => error?.name === 'AbortError');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  children[0].emit('close', null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  children[1].emit('close', 0);
  await second;
});

test('timeout, failed process, and invalid outputs fail closed without deleting the parent work directory', async () => {
  const child = fakeChild();
  const timeout = separateVoiceover({
    inputWavPath: '/tmp/input.wav', workDir: '/tmp/job-timeout', env: completeEnv(),
    deps: readyDeps({ checkReadiness: async () => ({ ready: true }), spawn: () => child,
      setTimeout: (callback) => { queueMicrotask(callback); return { unref() {} }; }, clearTimeout: () => {}, killProcessGroup: () => {}, }),
  });
  await assert.rejects(timeout, (error) => error?.code === 'voiceover_separation_timeout');
  child.emit('close', null);
  await new Promise((resolve) => setImmediate(resolve));
  const failedChild = fakeChild();
  const failed = separateVoiceover({ inputWavPath: '/tmp/input.wav', workDir: '/tmp/job-failed', env: completeEnv(), deps: readyDeps({ checkReadiness: async () => ({ ready: true }), spawn: () => { queueMicrotask(() => failedChild.emit('close', 1)); return failedChild; } }) });
  await assert.rejects(failed, (error) => error?.code === 'voiceover_separation_unavailable');
  const emptyChild = fakeChild();
  const empty = separateVoiceover({ inputWavPath: '/tmp/input.wav', workDir: '/tmp/job-empty', env: completeEnv(), deps: readyDeps({ checkReadiness: async () => ({ ready: true }), spawn: () => { queueMicrotask(() => emptyChild.emit('close', 0)); return emptyChild; }, stat: async () => ({ size: 0 }) }) });
  await assert.rejects(empty, (error) => error?.code === 'voiceover_separation_unavailable');
});

test('duration drift fails closed and never cleans the server-owned parent directory', async () => {
  const child = fakeChild();
  let cleanupCalls = 0;
  const pending = separateVoiceover({
    inputWavPath: '/tmp/input.wav', workDir: '/tmp/owned-parent', env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }), spawn: () => { queueMicrotask(() => child.emit('close', 0)); return child; },
      stat: async () => ({ size: 10 }), rm: async () => { cleanupCalls += 1; },
      probeDurationMs: async (filePath) => filePath.endsWith('/vocals.pcm.wav') ? 1_250 : 1_000,
    }),
  });
  await assert.rejects(pending, (error) => error?.code === 'voiceover_separation_unavailable');
  assert.equal(cleanupCalls, 0);
});

test('private work directories are created after a permit, cleaned on failure, and transferable on success', async () => {
  const child = fakeChild();
  const cleanupCalls = [];
  const success = separateVoiceover({
    inputWavPath: '/tmp/input.wav', env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }),
      mkdtemp: async () => '/tmp/private-success',
      rm: async (...args) => { cleanupCalls.push(args); },
      spawn: () => { queueMicrotask(() => child.emit('close', 0)); return child; },
      stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
    }),
  });
  const result = await success;
  assert.equal(typeof result.cleanupWorkDir, 'function');
  await result.cleanupWorkDir();
  assert.deepEqual(cleanupCalls, [['/tmp/private-success', { recursive: true, force: true }]]);

  const failedChild = fakeChild();
  const failedCleanup = [];
  await assert.rejects(separateVoiceover({
    inputWavPath: '/tmp/input.wav', env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }), mkdtemp: async () => '/tmp/private-failure',
      rm: async (...args) => { failedCleanup.push(args); },
      spawn: () => { queueMicrotask(() => failedChild.emit('close', 1)); return failedChild; },
    }),
  }));
  assert.deepEqual(failedCleanup, [['/tmp/private-failure', { recursive: true, force: true }]]);
});

test('a queued private job does not allocate a work directory before its FIFO permit', async () => {
  const children = [fakeChild(), fakeChild()];
  let spawnCount = 0;
  let mkdtempCount = 0;
  const deps = readyDeps({
    checkReadiness: async () => ({ ready: true }), stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
    spawn: () => children[spawnCount++],
    mkdtemp: async () => { mkdtempCount += 1; return '/tmp/queued-private'; },
    rm: async () => {},
  });
  const first = separateVoiceover({ inputWavPath: '/tmp/first.wav', workDir: '/tmp/external-first', env: completeEnv(), deps });
  const second = separateVoiceover({ inputWavPath: '/tmp/second.wav', env: completeEnv(), deps });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mkdtempCount, 0);
  children[0].emit('close', 0);
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mkdtempCount, 1);
  children[1].emit('close', 0);
  const result = await second;
  await result.cleanupWorkDir();
});

test('cancelling an allocated private job cleans its owned directory after child close', async () => {
  const controller = new AbortController();
  const child = fakeChild();
  const cleanupCalls = [];
  const pending = separateVoiceover({
    inputWavPath: '/tmp/input.wav', signal: controller.signal, env: completeEnv(),
    deps: readyDeps({
      checkReadiness: async () => ({ ready: true }), mkdtemp: async () => '/tmp/private-abort', spawn: () => child,
      killProcessGroup: () => {}, rm: async (...args) => { cleanupCalls.push(args); },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  child.emit('close', null);
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  assert.deepEqual(cleanupCalls, [['/tmp/private-abort', { recursive: true, force: true }]]);
});
