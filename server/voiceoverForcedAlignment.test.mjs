import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  alignVoiceoverTurns,
  buildVoiceoverTurnAlignment,
  checkVoiceoverAlignmentReadiness,
  resolveVoiceoverWhisperLanguage,
} from './voiceoverForcedAlignment.mjs';
import { acquireVoiceoverHeavyProcessPermit } from './voiceoverHeavyProcessLimiter.mjs';

const alignmentConfig = Object.freeze({
  alignmentPython: '/opt/meiao/voiceover/bin/python',
  whisperModelDir: '/opt/meiao/voiceover/models/faster-whisper-base',
  alignmentTimeoutMs: 120_000,
  alignmentMaxOutputBytes: 64 * 1024,
  alignmentMinSimilarity: 0.8,
  alignmentMinTurnDurationMs: 40,
});

test('exact English words map to one monotonic acoustic window per turn', () => {
  const result = buildVoiceoverTurnAlignment({
    turns: [{ text: 'Install the basket.' }, { text: 'Press firmly.' }],
    recognition: recognition([
      word('Install', 100, 400),
      word(' the', 400, 550),
      word(' basket', 550, 1_000),
      word(' Press', 1_300, 1_600),
      word(' firmly', 1_600, 2_000),
    ], 'Install the basket. Press firmly.'),
    minSimilarity: 0.8,
    minTurnDurationMs: 40,
  });
  assert.equal(result.similarity, 1);
  assert.deepEqual(result.groups, [
    { index: 0, sourceStartMs: 100, sourceEndMs: 1_000, actualDurationMs: 900 },
    { index: 1, sourceStartMs: 1_300, sourceEndMs: 2_000, actualDurationMs: 700 },
  ]);
});

test('normalization tolerates punctuation and case drift but preserves the provider transcript', () => {
  const result = buildVoiceoverTurnAlignment({
    turns: [{ text: 'Hello, WORLD!' }],
    recognition: recognition([
      word('hello', 50, 250),
      word(' world', 250, 600),
    ], 'hello world'),
    minSimilarity: 0.8,
  });
  assert.equal(result.similarity, 1);
  assert.equal(result.transcript, 'hello world');
  assert.deepEqual(result.groups, [
    { index: 0, sourceStartMs: 50, sourceEndMs: 600, actualDurationMs: 550 },
  ]);
});

test('one-character ASR substitutions stay local instead of corrupting a short turn', () => {
  const result = buildVoiceoverTurnAlignment({
    turns: [{ text: 'Fold down to save space. Very convenient.' }],
    recognition: recognition([
      word('Fold', 100, 350),
      word(' down', 350, 600),
      word(' to', 600, 750),
      word(' safe', 750, 1_000),
      word(' space', 1_000, 1_300),
      word(' Very', 1_500, 1_800),
      word(' convenient', 1_800, 2_300),
    ], 'Fold down to safe space. Very convenient.'),
    minSimilarity: 0.82,
  });

  assert.equal(result.similarity > 0.95, true);
  assert.deepEqual(result.groups, [{
    index: 0,
    sourceStartMs: 100,
    sourceEndMs: 2_300,
    actualDurationMs: 2_200,
  }]);
});

test('Mandarin and documented aliases use Whisper language codes with no-space text', () => {
  assert.equal(resolveVoiceoverWhisperLanguage('cmn'), 'zh');
  assert.equal(resolveVoiceoverWhisperLanguage('fil'), 'tl');
  assert.equal(resolveVoiceoverWhisperLanguage('jv'), 'jw');
  assert.equal(resolveVoiceoverWhisperLanguage('nb'), 'no');
  assert.equal(resolveVoiceoverWhisperLanguage('ceb'), undefined);

  const result = buildVoiceoverTurnAlignment({
    turns: [{ text: '安装篮子' }, { text: '按压固定' }],
    recognition: recognition([
      word('安装', 100, 350),
      word('篮子', 350, 700),
      word('按压', 900, 1_150),
      word('固定', 1_150, 1_500),
    ], '安装篮子按压固定', 'zh'),
    minSimilarity: 0.8,
  });
  assert.equal(result.similarity, 1);
  assert.deepEqual(result.groups.map(({ sourceStartMs, sourceEndMs }) => [
    sourceStartMs,
    sourceEndMs,
  ]), [[100, 700], [900, 1_500]]);
});

test('alignment fails closed for low similarity, shared words, and invalid timestamps', () => {
  assert.throws(
    () => buildVoiceoverTurnAlignment({
      turns: [{ text: 'Install the basket' }],
      recognition: recognition([word('completely', 100, 300), word('different', 300, 600)]),
      minSimilarity: 0.8,
    }),
    (error) => error.code === 'voiceover_forced_alignment_failed',
  );
  assert.throws(
    () => buildVoiceoverTurnAlignment({
      turns: [{ text: 'hello' }, { text: 'world' }],
      recognition: recognition([word('helloworld', 100, 600)]),
      minSimilarity: 0.8,
    }),
    (error) => error.code === 'voiceover_forced_alignment_failed',
  );
  assert.throws(
    () => buildVoiceoverTurnAlignment({
      turns: [{ text: 'first' }, { text: 'second' }],
      recognition: recognition([
        word('first', 500, 900),
        word('second', 850, 1_100),
      ]),
      minSimilarity: 0.8,
    }),
    (error) => error.code === 'voiceover_forced_alignment_failed',
  );
});

test('runtime sends only bounded local alignment input and uses automatic detection when needed', async () => {
  const calls = [];
  const permitCalls = [];
  let releaseCalls = 0;
  const result = await alignVoiceoverTurns({
    audioPath: '/tmp/continuous.wav',
    turns: [{ text: 'Maayong adlaw' }],
    targetLanguage: 'ceb',
    config: alignmentConfig,
    deps: {
      acquireHeavyProcessPermit: async (...args) => {
        permitCalls.push(args);
        return () => { releaseCalls += 1; };
      },
      runProcess: async (command, args, options) => {
        calls.push({ command, args, options });
        return {
          exitCode: 0,
          stdout: JSON.stringify(recognition([
            word('Maayong', 100, 450),
            word(' adlaw', 450, 800),
          ], 'Maayong adlaw', 'ceb')),
          stderr: '',
        };
      },
    },
  });
  assert.equal(result.groups.length, 1);
  assert.deepEqual(permitCalls, [[undefined, 1]]);
  assert.equal(releaseCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, alignmentConfig.alignmentPython);
  assert.equal(calls[0].args[0], '-c');
  assert.equal(calls[0].options.timeoutMs, alignmentConfig.alignmentTimeoutMs);
  assert.equal(calls[0].options.maxOutputBytes, alignmentConfig.alignmentMaxOutputBytes);
  assert.deepEqual(JSON.parse(calls[0].options.input), {
    audioPath: '/tmp/continuous.wav',
    modelPath: alignmentConfig.whisperModelDir,
    language: null,
  });
  assert.match(calls[0].args[1], /"condition_on_previous_text": False/u);
  assert.match(calls[0].args[1], /"initial_prompt": None/u);
  assert.doesNotMatch(calls[0].args[1], /payload\["initialPrompt"\]/u);
  assert.doesNotMatch(JSON.stringify(result), /\/tmp\/|models\/faster-whisper/);
});

test('alignment keeps the shared heavy-process permit until an aborted child closes', async () => {
  const controller = new AbortController();
  const child = fakeChild();
  const pending = alignVoiceoverTurns({
    audioPath: '/tmp/continuous.wav',
    turns: [{ text: 'Hello world' }],
    targetLanguage: 'en',
    signal: controller.signal,
    config: alignmentConfig,
    deps: {
      spawnProcess: () => child,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  controller.abort();
  let nextStarted = false;
  const nextPermit = acquireVoiceoverHeavyProcessPermit(undefined, 1).then((release) => {
    nextStarted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextStarted, false);

  child.emit('close', null);
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  const releaseNext = await nextPermit;
  assert.equal(nextStarted, true);
  releaseNext();
});

test('alignment preserves process-close evidence when timeout errors are normalized', async () => {
  let closeProcess;
  const processClosed = new Promise((resolve) => {
    closeProcess = resolve;
  });
  let permitReleases = 0;
  const processError = Object.assign(new Error('private timeout detail'), {
    code: 'voiceover_alignment_timeout',
  });
  Object.defineProperty(processError, 'releasePermitWhenClosed', {
    value: processClosed,
    enumerable: false,
  });

  await assert.rejects(
    alignVoiceoverTurns({
      audioPath: '/tmp/continuous.wav',
      turns: [{ text: 'Hello world' }],
      targetLanguage: 'en',
      config: alignmentConfig,
      deps: {
        acquireHeavyProcessPermit: async () => () => {
          permitReleases += 1;
        },
        runProcess: async () => {
          throw processError;
        },
      },
    }),
    (error) => (
      error?.code === 'voiceover_forced_alignment_failed'
      && error.releasePermitWhenClosed === processClosed
      && !String(error.message).includes('private timeout detail')
    ),
  );
  assert.equal(permitReleases, 0);
  closeProcess();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(permitReleases, 1);
});

test('runtime rejects oversized output, cancellation, timeout, and malformed process results', async () => {
  const base = {
    audioPath: '/tmp/continuous.wav',
    turns: [{ text: 'Hello world' }],
    targetLanguage: 'en',
    config: alignmentConfig,
  };
  await assert.rejects(
    alignVoiceoverTurns({
      ...base,
      deps: {
        runProcess: async () => ({
          exitCode: 0,
          stdout: 'x'.repeat(alignmentConfig.alignmentMaxOutputBytes + 1),
          stderr: '',
        }),
      },
    }),
    (error) => error.code === 'voiceover_forced_alignment_failed',
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    alignVoiceoverTurns({
      ...base,
      signal: controller.signal,
      deps: {
        runProcess: async () => {
          assert.fail('aborted alignment must not spawn');
        },
      },
    }),
    (error) => error.name === 'AbortError',
  );

  await assert.rejects(
    alignVoiceoverTurns({
      ...base,
      deps: {
        runProcess: async () => {
          throw Object.assign(new Error('timed out'), { code: 'voiceover_alignment_timeout' });
        },
      },
    }),
    (error) => error.code === 'voiceover_forced_alignment_failed',
  );
  await assert.rejects(
    alignVoiceoverTurns({
      ...base,
      deps: {
        runProcess: async () => ({ exitCode: 1, stdout: '', stderr: 'private stack' }),
      },
    }),
    (error) => (
      error.code === 'voiceover_forced_alignment_failed'
      && !String(error.message).includes('private stack')
    ),
  );
});

test('readiness verifies the pinned package and a local-only model load', async () => {
  const calls = [];
  const ready = await checkVoiceoverAlignmentReadiness({
    config: alignmentConfig,
    deps: {
      loadWhisperManifest: async () => ({ files: [] }),
      verifyWhisperModelFiles: async () => ({ ready: true }),
      runProcess: async (command, args, options) => {
        calls.push({ command, args, options });
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            fasterWhisperVersion: '1.2.1',
            modelLoaded: true,
          }),
          stderr: '',
        };
      },
    },
  });
  assert.deepEqual(ready, {
    ready: true,
    code: null,
    pythonReady: true,
    modelReady: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, alignmentConfig.alignmentPython);
  assert.deepEqual(JSON.parse(calls[0].options.input), {
    modelPath: alignmentConfig.whisperModelDir,
  });

  const unavailable = await checkVoiceoverAlignmentReadiness({
    config: alignmentConfig,
    deps: {
      loadWhisperManifest: async () => ({ files: [] }),
      verifyWhisperModelFiles: async () => ({ ready: true }),
      runProcess: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          fasterWhisperVersion: '1.2.0',
          modelLoaded: true,
        }),
        stderr: '',
      }),
    },
  });
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.code, 'voiceover_alignment_unavailable');
});

test('readiness rejects a drifted Whisper inventory before starting Python', async () => {
  let processCalls = 0;
  const unavailable = await checkVoiceoverAlignmentReadiness({
    config: alignmentConfig,
    deps: {
      loadWhisperManifest: async () => ({ files: [] }),
      verifyWhisperModelFiles: async ({ modelDir }) => {
        assert.equal(modelDir, alignmentConfig.whisperModelDir);
        return { ready: false };
      },
      runProcess: async () => {
        processCalls += 1;
        return { exitCode: 0, stdout: '{}', stderr: '' };
      },
    },
  });
  assert.equal(processCalls, 0);
  assert.deepEqual(unavailable, {
    ready: false,
    code: 'voiceover_alignment_unavailable',
    pythonReady: false,
    modelReady: false,
  });
});

function word(text, startMs, endMs) {
  return { text, startMs, endMs };
}

function recognition(words, transcript = words.map(({ text }) => text).join(''), detectedLanguage = 'en') {
  return { transcript, detectedLanguage, words };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = { end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}
