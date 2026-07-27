import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  checkVoiceoverSeparationReadiness,
  separateVoiceover,
} from './voiceoverSeparation.mjs';

const manifest = { schemaVersion: 1, model: 'mdx_q', files: [{ name: 'model.th', size: 4, sha256: 'a'.repeat(64), url: 'https://example.invalid/model.th' }] };
const mdxQYaml = `models: ['6b9c2ca1', 'b72baf4e', '42e558d4', '305bc58f']\nweights: [\n  [1., 1., 0., 0.],\n  [0., 1., 0., 0.],\n  [1., 0., 1., 1.],\n  [1., 0., 1., 1.],\n]\nsegment: 44\n`;

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
  yamlText: mdxQYaml,
  verifyDemucsModelFiles: async () => ({ ready: true, files: [] }),
  runProcess: async (_command, args) => args.includes('-filters')
    ? { exitCode: 0, stdout: ' ... sidechaincompress ... amix ... adelay ... afade ... atempo ... alimiter ... ' }
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
        : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' };
    } }),
  });
  assert.deepEqual(readiness, { ready: true, code: null, pythonReady: true, modelReady: true, ffmpegReady: true });
  assert.deepEqual(calls.map((call) => call.args), [
    ['-c', 'import importlib.metadata as m, torch, torchaudio; print("|".join((m.version("demucs"), m.version("torch"), m.version("torchaudio"))))'],
    ['-hide_banner', '-filters'],
  ]);
  assert.doesNotMatch(JSON.stringify(readiness), /\/configured\/|secret|token|https?:/i);
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
      : { exitCode: 0, stdout: '4.0.1|2.7.1|2.7.1\n' } }),
  });
  assert.deepEqual(versionDrift, { ready: false, code: 'voiceover_separation_unavailable', pythonReady: false, modelReady: true, ffmpegReady: true });
  const filterDrift = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: readyDeps({ runProcess: async (_command, args) => args.includes('-filters')
      ? { exitCode: 0, stdout: 'sidechaincompress amix adelay afade atempo' }
      : { exitCode: 0, stdout: '4.0.1|2.7.1+cpu|2.7.1+cpu\n' } }),
  });
  assert.deepEqual(filterDrift, { ready: false, code: 'voiceover_separation_unavailable', pythonReady: true, modelReady: true, ffmpegReady: false });
});

test('spawns mdx_q cpu two-stem separation without a shell', async () => {
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
    '-m', 'demucs.separate', '-n', 'mdx_q', '-d', 'cpu', '-j', '1', '--two-stems=vocals',
    '--repo', '/configured/models', '--out', '/tmp/job-1/separated', '/tmp/input with $(touch nope).wav',
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.deepEqual(result, {
    vocalsPath: '/tmp/job-1/separated/mdx_q/input with $(touch nope)/vocals.wav',
    backgroundPath: '/tmp/job-1/separated/mdx_q/input with $(touch nope)/no_vocals.wav', model: 'mdx_q', durationMs: 1000,
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

test('abort terminates the detached process group then bounds a SIGKILL fallback', async () => {
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
  await assert.rejects(first, (error) => error?.name === 'AbortError');
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
