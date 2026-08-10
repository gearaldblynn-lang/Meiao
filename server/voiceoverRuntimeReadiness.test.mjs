import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkVoiceoverRuntimeReadiness } from './voiceoverRuntimeReadiness.mjs';

test('runtime readiness requires both separation and forced alignment without exposing paths', async () => {
  const calls = [];
  const readiness = await checkVoiceoverRuntimeReadiness({
    env: { SECRET_TOKEN: 'must-not-leak' },
    deps: {
      checkSeparation: async (options) => {
        calls.push(['separation', options]);
        return {
          ready: true,
          code: null,
          pythonReady: true,
          modelReady: true,
          ffmpegReady: true,
        };
      },
      checkAlignment: async (options) => {
        calls.push(['alignment', options]);
        return {
          ready: true,
          code: null,
          pythonReady: true,
          modelReady: true,
        };
      },
    },
  });
  assert.deepEqual(readiness, {
    ready: true,
    code: null,
    pythonReady: true,
    modelReady: true,
    ffmpegReady: true,
  });
  assert.deepEqual(calls.map(([name, options]) => [name, options.verifyModelLoad]), [
    ['separation', false],
    ['alignment', false],
  ]);
  assert.doesNotMatch(JSON.stringify(readiness), /SECRET_TOKEN|must-not-leak|\/Users\/|\/opt\//);
});

test('runtime readiness fails closed when either local model runtime is unavailable', async () => {
  const readiness = await checkVoiceoverRuntimeReadiness({
    deps: {
      checkSeparation: async () => ({
        ready: true,
        pythonReady: true,
        modelReady: true,
        ffmpegReady: true,
      }),
      checkAlignment: async () => ({
        ready: false,
        code: 'voiceover_alignment_unavailable',
        pythonReady: true,
        modelReady: false,
      }),
    },
  });
  assert.deepEqual(readiness, {
    ready: false,
    code: 'voiceover_unavailable',
    pythonReady: true,
    modelReady: false,
    ffmpegReady: true,
  });
});

test('explicit release readiness loads both pinned local models', async () => {
  const calls = [];
  let finishSeparation;
  const separationPending = new Promise((resolve) => {
    finishSeparation = resolve;
  });
  const pending = checkVoiceoverRuntimeReadiness({
    verifyModelLoad: true,
    deps: {
      checkSeparation: async (options) => {
        calls.push(['separation', options.verifyModelLoad]);
        await separationPending;
        return {
          ready: true,
          pythonReady: true,
          modelReady: true,
          ffmpegReady: true,
        };
      },
      checkAlignment: async (options) => {
        calls.push(['alignment', options.verifyModelLoad]);
        return {
          ready: true,
          pythonReady: true,
          modelReady: true,
        };
      },
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [['separation', true]]);
  finishSeparation();
  const readiness = await pending;
  assert.equal(readiness.ready, true);
  assert.deepEqual(calls, [
    ['separation', true],
    ['alignment', true],
  ]);
});

test('server wires continuous forced alignment and joint readiness into the production runner', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(source, /checkVoiceoverRuntimeReadiness/);
  assert.match(source, /alignVoiceoverTurns/);
  assert.match(source, /alignContinuousVoiceover/);
  const dependencyFactory = source.match(
    /const createVoiceoverRunnerDependencies[\s\S]*?\n\};\n\nconst executeApplicationJob/,
  )?.[0] || '';
  assert.match(dependencyFactory, /alignTurns:\s*\([^)]*\)\s*=>\s*alignVoiceoverTurns\(/);
  assert.match(dependencyFactory, /alignContinuousAudio:\s*\([^)]*\)\s*=>\s*alignContinuousVoiceover\(/);
  const bootstrap = source.match(/const bootstrap = async \(\) => \{[\s\S]*?\n\};\n\nbootstrap\(\)/)?.[0] || '';
  assert.match(bootstrap, /voiceoverTranslationReadiness = await checkVoiceoverRuntimeReadiness\(/);
  assert.doesNotMatch(bootstrap, /voiceoverTranslationReadiness = await checkVoiceoverSeparationReadiness\(/);
});
