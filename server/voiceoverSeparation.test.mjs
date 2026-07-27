import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  checkVoiceoverSeparationReadiness,
  separateVoiceover,
} from './voiceoverSeparation.mjs';
import { resolvePackagedFfprobePath } from './mediaTranscodeService.mjs';

const manifest = { schemaVersion: 1, model: 'mdx', files: [{ name: 'model.th', size: 4, sha256: 'a'.repeat(64), url: 'https://example.invalid/model.th' }] };
const mdxYaml = `models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;

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
      : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' },
  ...extra,
});

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('runtime readiness fails closed on one mismatched model hash', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ verifyDemucsModelFiles: async () => ({ ready: false, files: [{ name: 'model.th', ready: false }] }) }),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.modelReady, false);
  assert.equal(readiness.code, 'voiceover_separation_unavailable');
});

test('readiness validates Python imports, the exact Demucs version, and required FFmpeg filters without leaking paths', async () => {
  const calls = [];
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ runProcess: async (command, args) => {
      calls.push({ command, args });
      return args.includes('-filters')
        ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo alimiter' }
        : args[1].includes('demucs.pretrained') ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
        : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' };
    } }),
  });
  assert.deepEqual(readiness, { ready: true, code: null, pythonReady: true, modelReady: true, ffmpegReady: true });
  assert.deepEqual(calls.map((call) => call.args), [
    ['-c', 'import importlib.metadata as m, torch, torchaudio; print("|".join((m.version("demucs"), m.version("torch"), m.version("torchaudio"))))'],
    ['-c', 'import sys; from pathlib import Path; from demucs.pretrained import get_model; get_model("mdx", Path(sys.argv[1])); print("mdx-load-ok")', '/configured/models'],
    ['-hide_banner', '-filters'],
  ]);
  assert.doesNotMatch(JSON.stringify(readiness), /\/configured\/|secret|token|https?:/i);
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
      : { exitCode: 0, stdout: '4.0.1|2.7.1|2.7.1\n' } }),
  });
  assert.deepEqual(versionDrift, { ready: false, code: 'voiceover_separation_unavailable', pythonReady: false, modelReady: true, ffmpegReady: true });
  const filterDrift = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ runProcess: async (_command, args) => args.includes('-filters')
      ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo' }
      : args[1].includes('demucs.pretrained') ? { exitCode: 0, stdout: 'mdx-load-ok\n' }
      : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' } }),
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
      : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' } }),
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
          : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' };
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
  const pending = separateVoiceover({
    inputWavPath: '/tmp/input with $(touch nope).wav', workDir: '/tmp/job-1', env: completeEnv(),
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
  assert.deepEqual(result, {
    vocalsPath: '/tmp/job-1/separated/mdx/input with $(touch nope)/vocals.wav',
    backgroundPath: '/tmp/job-1/separated/mdx/input with $(touch nope)/no_vocals.wav', model: 'mdx', durationMs: 1000,
  });
});

test('global queue is FIFO and keeps the configured concurrency bound', async () => {
  const children = [];
  const calls = [];
  const deps = readyDeps({
    checkReadiness: async () => ({ ready: true }), stat: async () => ({ size: 10 }), probeDurationMs: async () => 1000,
    spawn: (...args) => { calls.push(args); const child = fakeChild(); children.push(child); return child; },
  });
  const first = separateVoiceover({ inputWavPath: '/tmp/first.wav', workDir: '/tmp/first', env: completeEnv(), deps });
  const second = separateVoiceover({ inputWavPath: '/tmp/second.wav', workDir: '/tmp/second', env: completeEnv(), deps });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  children[0].emit('close', 0);
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
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
      probeDurationMs: async (filePath) => filePath.includes('vocals.wav') ? 1_250 : 1_000,
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
