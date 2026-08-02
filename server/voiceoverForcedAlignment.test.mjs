import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignVoiceoverTurns,
  buildVoiceoverTurnAlignment,
  checkVoiceoverAlignmentReadiness,
  resolveVoiceoverWhisperLanguage,
} from './voiceoverForcedAlignment.mjs';

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
  const result = await alignVoiceoverTurns({
    audioPath: '/tmp/continuous.wav',
    turns: [{ text: 'Maayong adlaw' }],
    targetLanguage: 'ceb',
    config: alignmentConfig,
    deps: {
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, alignmentConfig.alignmentPython);
  assert.equal(calls[0].args[0], '-c');
  assert.equal(calls[0].options.timeoutMs, alignmentConfig.alignmentTimeoutMs);
  assert.equal(calls[0].options.maxOutputBytes, alignmentConfig.alignmentMaxOutputBytes);
  assert.deepEqual(JSON.parse(calls[0].options.input), {
    audioPath: '/tmp/continuous.wav',
    modelPath: alignmentConfig.whisperModelDir,
    language: null,
    initialPrompt: 'Maayong adlaw',
  });
  assert.doesNotMatch(JSON.stringify(result), /\/tmp\/|models\/faster-whisper/);
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

function word(text, startMs, endMs) {
  return { text, startMs, endMs };
}

function recognition(words, transcript = words.map(({ text }) => text).join(''), detectedLanguage = 'en') {
  return { transcript, detectedLanguage, words };
}
