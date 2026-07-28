import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertVoiceoverWorkPath,
  getVoiceoverSourceMaxBytes,
  prepareVoiceoverSubmission,
  runVoiceoverTranslationJob,
  streamVoiceoverAssetToFile,
  withVoiceoverProbeWorkspace,
} from './voiceoverTranslationRunner.mjs';
import {
  createVoiceoverChildJobLedger,
  deriveVoiceoverRetryPlan,
  prepareVoiceoverJobRetryResult,
} from './voiceoverChildJobStore.mjs';
import { probeVoiceoverManagedMedia } from './voiceoverMediaProbe.mjs';

const VALID_ANALYSIS = {
  sourceLanguage: 'cmn',
  speakerCount: 1,
  voiceProfile: {
    pitch: 'medium',
    brightness: 'balanced',
    energy: 'balanced',
    pace: 'natural',
    accentDescription: 'clear',
  },
  segments: [{
    id: 'segment-1',
    startMs: 0,
    endMs: 1_000,
    sourceText: '源文',
    targetText: 'Translation',
  }],
};

const jsonAnalysis = (value = VALID_ANALYSIS) => JSON.stringify(value);

test('remote managed video materialization streams through a bounded part file and atomically publishes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voiceover-download-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destinationPath = path.join(root, 'source.mp4');
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];

  const result = await streamVoiceoverAssetToFile({
    remoteUrl: 'https://managed.invalid/source.mp4',
    destinationPath,
    maxBytes: 6,
    deps: {
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
      }), {
        status: 200,
        headers: { 'content-length': '6' },
      }),
    },
  });

  assert.equal(result.sizeBytes, 6);
  assert.deepEqual([...await readFile(destinationPath)], [1, 2, 3, 4, 5, 6]);
  await assert.rejects(access(`${destinationPath}.part`));
});

test('remote managed video materialization drains partial file writes before publish', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voiceover-partial-write-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const written = [];
  let renamed = false;

  const result = await streamVoiceoverAssetToFile({
    remoteUrl: 'https://managed.invalid/source.mp4',
    destinationPath: path.join(root, 'source.mp4'),
    maxBytes: 3,
    deps: {
      fetchImpl: async () => new Response(new Uint8Array([7, 8, 9]), { status: 200 }),
      openFile: async () => ({
        write: async (buffer, offset) => {
          written.push(buffer[offset]);
          return { bytesWritten: 1 };
        },
        sync: async () => {},
        close: async () => {},
      }),
      removeFile: async () => {},
      renameFile: async () => {
        renamed = true;
      },
    },
  });

  assert.deepEqual(written, [7, 8, 9]);
  assert.equal(result.sizeBytes, 3);
  assert.equal(renamed, true);
});

test('remote managed video materialization rejects streamed overflow and abort without partial files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voiceover-download-limit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const overflowDestination = path.join(root, 'overflow.mp4');

  await assert.rejects(
    streamVoiceoverAssetToFile({
      remoteUrl: 'https://managed.invalid/overflow.mp4',
      destinationPath: overflowDestination,
      maxBytes: 5,
      deps: {
        fetchImpl: async () => new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            controller.enqueue(new Uint8Array([5, 6, 7, 8]));
            controller.close();
          },
        }), { status: 200 }),
      },
    }),
    (error) => error?.code === 'voiceover_source_too_large',
  );
  await assert.rejects(access(overflowDestination));
  await assert.rejects(access(`${overflowDestination}.part`));

  const abortDestination = path.join(root, 'aborted.mp4');
  const abortController = new AbortController();
  await assert.rejects(
    streamVoiceoverAssetToFile({
      remoteUrl: 'https://managed.invalid/aborted.mp4',
      destinationPath: abortDestination,
      maxBytes: 10,
      signal: abortController.signal,
      deps: {
        fetchImpl: async () => new Response(new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array([1]));
            abortController.abort();
          },
        }), { status: 200 }),
      },
    }),
    (error) => error?.code === 'request_cancelled',
  );
  await assert.rejects(access(abortDestination));
  await assert.rejects(access(`${abortDestination}.part`));
});

test('voiceover source byte limit is env-backed and bounded by the established upload ceiling', () => {
  assert.equal(getVoiceoverSourceMaxBytes({ MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES: '1048576' }), 1024 * 1024);
  assert.equal(getVoiceoverSourceMaxBytes({ MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES: '99999999999' }), 1024 * 1024 * 1024);
  assert.equal(getVoiceoverSourceMaxBytes({ MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES: '2097152' }), 2 * 1024 * 1024);
});

test('prepares a voiceover submission from current-user ownership and trusted probe only', async () => {
  const calls = [];
  const body = {
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    payload: {
      taskType: 'voiceover_translate_video',
      taskPurpose: 'voiceover_translation',
      subFeature: 'voiceover_translation',
      userId: 'user-1',
      sourceAssetId: 'asset-source',
      shellProjectId: 'project-1',
      shellProjectName: '口播翻译',
      shellResultId: 'result-1',
      clientSubmissionKey: 'voiceover-submit-1',
      targetLanguage: 'en',
      translationMode: 'natural',
      voiceMode: 'preset',
      voiceName: 'Kore',
      removeText: false,
    },
  };

  const prepared = await prepareVoiceoverSubmission({
    body,
    userId: 'user-1',
    resolveOwnedAsset: async (identity) => {
      calls.push(['resolve', identity]);
      return {
        assetId: 'asset-source',
        userId: 'user-1',
        publicUrl: '/api/assets/file/asset-source/source.mp4',
      };
    },
    probeVideo: async (asset) => {
      calls.push(['probe', asset.assetId]);
      return { durationMs: 9_000, hasAudio: true, width: 1080, height: 1920 };
    },
  });

  assert.deepEqual(calls.map(([kind]) => kind), ['resolve', 'probe']);
  assert.equal(prepared.body.payload.subFeature, 'voiceover_translation');
  assert.equal(prepared.body.payload.userId, 'user-1');
  assert.deepEqual(prepared.sourceProbe, {
    durationMs: 9_000,
    hasAudio: true,
    width: 1080,
    height: 1920,
  });
  assert.equal(JSON.stringify(prepared).includes('/Users/'), false);
  assert.equal('path' in prepared.body.payload, false);
});

test('voiceover submission preparation rejects ownership drift and leaves other tasks unchanged', async () => {
  const foreign = {
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    payload: {
      taskType: 'voiceover_translate_video',
      taskPurpose: 'voiceover_translation',
      sourceAssetId: 'asset-source',
      shellProjectId: 'project-1',
      shellProjectName: '口播翻译',
      shellResultId: 'result-1',
      clientSubmissionKey: 'voiceover-submit-1',
      targetLanguage: 'en',
      translationMode: 'natural',
      voiceMode: 'auto',
      removeText: false,
    },
  };
  let probeCalls = 0;

  await assert.rejects(
    prepareVoiceoverSubmission({
      body: foreign,
      userId: 'user-1',
      resolveOwnedAsset: async () => ({ assetId: 'asset-source', userId: 'user-2' }),
      probeVideo: async () => {
        probeCalls += 1;
        return { durationMs: 1_000, hasAudio: true };
      },
    }),
    (error) => error?.code === 'managed_asset_forbidden',
  );
  assert.equal(probeCalls, 0);

  const ordinary = { taskType: 'kie_image', payload: { prompt: 'keep-me' } };
  assert.deepEqual(
    await prepareVoiceoverSubmission({ body: ordinary, userId: 'user-1' }),
    { body: ordinary, sourceProbe: null },
  );
});

test('voiceover submission sourceUrl cannot resolve to another same-user asset', async () => {
  const body = {
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    payload: {
      taskType: 'voiceover_translate_video',
      taskPurpose: 'voiceover_translation',
      sourceUrl: 'managed://asset-requested',
      shellProjectId: 'project-1',
      shellProjectName: '口播翻译',
      shellResultId: 'result-1',
      clientSubmissionKey: 'voiceover-submit-url',
      targetLanguage: 'en',
      translationMode: 'natural',
      voiceMode: 'auto',
      removeText: false,
    },
  };

  await assert.rejects(
    prepareVoiceoverSubmission({
      body,
      userId: 'user-1',
      resolveOwnedAsset: async () => ({
        assetId: 'asset-unrelated',
        userId: 'user-1',
      }),
      probeVideo: async () => ({ durationMs: 1_000, hasAudio: true }),
    }),
    (error) => error?.code === 'managed_asset_forbidden',
  );
});

test('submission probe workspace always cleans and preserves the primary failure', async () => {
  const calls = [];
  const success = await withVoiceoverProbeWorkspace({
    createWorkRoot: async () => '/server-owned/probe-1',
    cleanupWorkRoot: async (root) => calls.push(`cleanup:${root}`),
    operation: async (root) => {
      calls.push(`probe:${root}`);
      return { hasAudio: true };
    },
  });
  assert.deepEqual(success, { hasAudio: true });

  const primary = Object.assign(new Error('probe cancelled'), {
    name: 'AbortError',
    code: 'request_cancelled',
  });
  await assert.rejects(
    withVoiceoverProbeWorkspace({
      createWorkRoot: async () => '/server-owned/probe-2',
      cleanupWorkRoot: async (root) => {
        calls.push(`cleanup:${root}`);
        throw new Error('cleanup failed');
      },
      operation: async () => {
        throw primary;
      },
    }),
    (error) => error === primary,
  );
  assert.deepEqual(calls, [
    'probe:/server-owned/probe-1',
    'cleanup:/server-owned/probe-1',
    'cleanup:/server-owned/probe-2',
  ]);
});

const checkpointAt = (stage) => {
  const checkpoint = {
    version: 1,
    stage,
    baseVideoAssetId: 'asset-source',
    analysisAttempt: 0,
  };
  const ranks = [
    'input_prepared',
    'audio_extracted',
    'voice_separated',
    'speech_analysis_submitting',
    'speech_analyzed',
    'translated',
    'tts_generating',
    'audio_aligned',
    'result_persisted',
  ];
  const rank = ranks.indexOf(stage);
  if (rank >= 1) checkpoint.originalAudioAssetId = 'asset-original-audio';
  if (rank >= 2) {
    checkpoint.vocalAssetId = 'asset-vocal';
    checkpoint.backgroundAssetId = 'asset-background';
  }
  if (rank >= 4) checkpoint.analysis = VALID_ANALYSIS;
  if (rank >= 5) {
    checkpoint.translation = {
      targetLanguage: 'en',
      mode: 'natural',
      selectedVoiceName: 'Kore',
      segments: VALID_ANALYSIS.segments,
    };
  }
  if (rank >= 6) {
    checkpoint.ttsGroups = [{
      index: 0,
      attempt: 0,
      childJobId: 'child-tts-0',
      providerTaskId: 'provider-tts-0',
      assetId: 'asset-tts-0',
      status: 'succeeded',
      startMs: 0,
      endMs: 1_000,
      ...(rank >= 7 ? { actualDurationMs: 900, atempo: 0.9 } : {}),
    }];
  }
  if (rank >= 7) checkpoint.alignedAudioAssetId = 'asset-aligned';
  if (rank >= 8) checkpoint.finalAssetId = 'asset-final';
  return checkpoint;
};

const createParentJob = (overrides = {}) => {
  const { payload: payloadOverrides = {}, result = null, ...jobOverrides } = overrides;
  return {
    id: 'parent-job-1',
    userId: 'user-1',
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    status: 'running',
    payload: {
      taskPurpose: 'voiceover_translation',
      subFeature: 'voiceover_translation',
      sourceAssetId: 'asset-source',
      sourceUrl: 'managed://asset-source',
      shellProjectId: 'project-1',
      shellProjectName: '口播翻译',
      shellResultId: 'result-1',
      targetLanguage: 'en',
      translationMode: 'natural',
      voiceMode: 'preset',
      voiceName: 'Kore',
      removeText: false,
      ...payloadOverrides,
    },
    result,
    ...jobOverrides,
  };
};

const createHarness = async ({
  job = createParentJob(),
  analysisContent = jsonAnalysis(),
  env = {},
  overrides = {},
} = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voiceover-task9-test-'));
  const events = [];
  const assetRecords = new Map([
    ['asset-source', {
      assetId: 'asset-source',
      url: 'managed://asset-source',
      durationMs: 4_000,
      sizeBytes: 1_024,
      width: 1080,
      height: 1920,
      hasAudio: true,
      userId: 'user-1',
    }],
  ]);
  const child = {
    id: 'child-tts-0',
    userId: 'user-1',
    module: 'video',
    taskType: 'kie_tts',
    provider: 'kie',
    status: 'running',
    providerTaskId: '',
    payload: {
      executionOwner: 'parent',
      parentJobId: 'parent-job-1',
      childKey: 'tts:0:attempt:0',
      groupIndex: 0,
      targetLanguage: 'en',
      voiceName: 'Kore',
      dialogueTurns: [{ speaker: 'Speaker 1', text: 'Translation' }],
      temperature: 1,
      scene: 'Translated product voiceover with natural, controlled pacing.',
      sampleContext: 'Use one consistent narrator and preserve punctuation and pauses.',
    },
  };

  const writeOutput = async (filePath, body = 'fixture') => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  };

  const deps = {
    createWorkRoot: async () => root,
    cleanupWorkRoot: async () => {
      events.push('cleanup');
    },
    resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
      const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
      const record = assetRecords.get(requestedId);
      if (!record || record.userId !== userId) {
        throw Object.assign(new Error('owned asset unavailable'), { code: 'managed_asset_forbidden' });
      }
      await writeOutput(destinationPath, requestedId);
      if (requestedId === 'asset-source') events.push('resolve-owned-source');
      return { ...record, path: destinationPath };
    },
    persistManagedFile: async ({ filePath, stage }) => {
      const byStage = {
        audio_extracted: ['asset-original-audio', 'managed://asset-original-audio'],
        voice_separated_vocal: ['asset-vocal', 'managed://asset-vocal'],
        voice_separated_background: ['asset-background', 'managed://asset-background'],
        speech_analysis_media: ['asset-analysis-media', 'https://managed.example/assets/analysis-media.mp4'],
        audio_aligned: ['asset-aligned', 'managed://asset-aligned'],
        result_persisted: ['asset-final', 'managed-final-url'],
      };
      const [assetId, url] = byStage[stage] || [];
      assert.ok(assetId, `unexpected persistence stage ${stage}`);
      assetRecords.set(assetId, {
        assetId,
        url,
        durationMs: 4_000,
        hasAudio: true,
        userId: 'user-1',
      });
      if (stage === 'result_persisted') events.push('persist-final');
      return { assetId, url, path: filePath };
    },
    probeMedia: async ({ filePath }) => ({
      durationMs: 4_000,
      hasAudio: true,
      width: 1080,
      height: 1920,
      filePath,
    }),
    extractAudio: async ({ outputWavPath }) => {
      events.push('extract-audio');
      await writeOutput(outputWavPath);
      return { durationMs: 4_000, sourceDurationMs: 4_000 };
    },
    separateVoice: async ({ workDir }) => {
      events.push('demucs');
      const vocalsPath = path.join(workDir, 'separated', 'vocals.wav');
      const backgroundPath = path.join(workDir, 'separated', 'no_vocals.wav');
      await writeOutput(vocalsPath);
      await writeOutput(backgroundPath);
      return { vocalsPath, backgroundPath, durationMs: 4_000 };
    },
    buildVocalOnlyVideo: async ({ outputPath }) => {
      events.push('build-vocal-only-video');
      await writeOutput(outputPath);
      return { durationMs: 4_000 };
    },
    analyzeSpeech: async () => {
      events.push('gemini-analysis');
      return { content: analysisContent };
    },
    childJobs: {
      getOrCreate: async () => {
        events.push('child:tts:0:create');
        return { ...child };
      },
      checkpointProviderTaskId: async (_childId, providerTaskId) => {
        events.push('child:tts:0:provider-checkpoint');
        child.providerTaskId = providerTaskId;
        return { ...child };
      },
      markSucceeded: async (_childId, result) => {
        events.push('child:tts:0:succeeded');
        child.status = 'succeeded';
        child.result = result;
        return { ...child };
      },
      markFailed: async (_childId, error) => {
        child.status = 'failed';
        child.errorCode = error?.code;
        return { ...child };
      },
      get: async () => ({ ...child }),
    },
    runTts: async ({ onProviderTaskId }) => {
      await onProviderTaskId('provider-tts-0');
      return {
        providerTaskId: 'provider-tts-0',
        result: { audioUrl: 'https://provider.example/tts.mp3' },
      };
    },
    persistTtsOutput: async () => {
      assetRecords.set('asset-tts-0', {
        assetId: 'asset-tts-0',
        url: 'managed://asset-tts-0',
        durationMs: 900,
        hasAudio: true,
        userId: 'user-1',
      });
      return {
        audioUrl: 'managed://asset-tts-0',
        audioUrlAssetId: 'asset-tts-0',
        durationMs: 900,
      };
    },
    alignAudio: async ({ outputPath }) => {
      events.push('align');
      await writeOutput(outputPath);
      return {
        durationMs: 4_000,
        groups: [{ index: 0, actualDurationMs: 900, atempo: 0.9 }],
      };
    },
    mixAudio: async ({ outputPath }) => {
      events.push('mix');
      await writeOutput(outputPath);
      return { durationMs: 4_000 };
    },
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  };

  const checkpoints = [];
  const checkpointContexts = [];
  const result = (runtimeSignal = new AbortController().signal) => runVoiceoverTranslationJob({
    job,
    env: { MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1', ...env },
    signal: runtimeSignal,
    onResultCheckpoint: async ({ voiceoverCheckpoint }, checkpointContext) => {
      checkpoints.push(structuredClone(voiceoverCheckpoint));
      checkpointContexts.push(checkpointContext);
      events.push(`persist:${voiceoverCheckpoint.stage}`);
    },
    deps,
  });

  return {
    root,
    events,
    checkpoints,
    checkpointContexts,
    deps,
    result,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

test('orchestrates the checkpoint-driven happy path in durable side-effect order', async (t) => {
  const harness = await createHarness();
  t.after(harness.cleanup);

  const output = await harness.result();

  assert.deepEqual(harness.events.filter((event) => event !== 'cleanup'), [
    'resolve-owned-source',
    'persist:input_prepared',
    'extract-audio',
    'persist:audio_extracted',
    'demucs',
    'persist:voice_separated',
    'build-vocal-only-video',
    'persist:speech_analysis_submitting',
    'gemini-analysis',
    'persist:speech_analyzed',
    'persist:translated',
    'child:tts:0:create',
    'child:tts:0:provider-checkpoint',
    'child:tts:0:succeeded',
    'persist:tts_generating',
    'align',
    'persist:audio_aligned',
    'mix',
    'persist-final',
    'persist:result_persisted',
  ]);
  assert.deepEqual(output.result, {
    videoUrl: 'managed-final-url',
    sourceUrl: 'managed://asset-source',
    sourceLanguage: 'cmn',
    targetLanguage: 'en',
    translationMode: 'natural',
    voiceName: 'Kore',
    sourceTranscript: '源文',
    translatedTranscript: 'Translation',
    voiceoverStage: 'result_persisted',
    finalAssetId: 'asset-final',
  });
  assert.equal(harness.events.at(-1), 'cleanup');
});

test('uses one normalized config snapshot and rejects dense target text before child or provider effects', async (t) => {
  const analysis = {
    ...VALID_ANALYSIS,
    segments: [{
      ...VALID_ANALYSIS.segments[0],
      targetText: 'x'.repeat(50),
    }],
  };
  let getConfigCalls = 0;
  let promptBudget = 0;
  let childCalls = 0;
  let ttsCalls = 0;
  const harness = await createHarness({
    analysisContent: jsonAnalysis(analysis),
    env: {
      MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND: '16',
      MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS: '321',
      MEIAO_VOICEOVER_GROUP_GAP_MS: '1234',
      MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS: '4096',
    },
    overrides: {
      buildAnalysisMessages: (options) => {
        promptBudget = options.maxTargetTextBytesPerSecond;
        return [];
      },
      getConfig: (runtimeEnv) => {
        getConfigCalls += 1;
        return {
          enabled: true,
          overlapToleranceMs: Number(runtimeEnv.MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS),
          maxTargetTextBytesPerSecond: Number(runtimeEnv.MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND),
          groupGapMs: Number(runtimeEnv.MEIAO_VOICEOVER_GROUP_GAP_MS),
          ttsMaxInputTokens: Number(runtimeEnv.MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS),
          minAtempo: 0.75,
          maxAtempo: 1.35,
          fadeMs: 40,
          durationToleranceMs: 100,
        };
      },
      childJobs: {
        getOrCreate: async () => {
          childCalls += 1;
          throw new Error('must not create child');
        },
      },
      runTts: async () => {
        ttsCalls += 1;
        throw new Error('must not call provider');
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_analysis_invalid',
  );
  assert.equal(getConfigCalls, 1);
  assert.equal(promptBudget, 16);
  assert.ok(harness.checkpointContexts.length > 0);
  assert.ok(harness.checkpointContexts.every((context) => (
    context?.voiceoverConfig?.maxTargetTextBytesPerSecond === 16
  )));
  assert.equal(childCalls, 0);
  assert.equal(ttsCalls, 0);
});

test('result_persisted returns managed assets without local or paid recomputation', async (t) => {
  const checkpoint = checkpointAt('result_persisted');
  let processCalls = 0;
  let providerCalls = 0;
  const harness = await createHarness({
    job: createParentJob({ result: { voiceoverCheckpoint: checkpoint } }),
    overrides: {
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        if (!['asset-source', 'asset-final'].includes(requestedId) || userId !== 'user-1') {
          throw new Error('unexpected asset');
        }
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: requestedId === 'asset-final' ? 'managed-final-url' : 'managed://asset-source',
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
        };
      },
      extractAudio: async () => { processCalls += 1; },
      separateVoice: async () => { processCalls += 1; },
      buildVocalOnlyVideo: async () => { processCalls += 1; },
      alignAudio: async () => { processCalls += 1; },
      mixAudio: async () => { processCalls += 1; },
      analyzeSpeech: async () => { providerCalls += 1; },
      runTts: async () => { providerCalls += 1; },
    },
  });
  t.after(harness.cleanup);

  const output = await harness.result();

  assert.equal(output.result.videoUrl, 'managed-final-url');
  assert.equal(processCalls, 0);
  assert.equal(providerCalls, 0);
});

test('resumes each durable checkpoint at the next allowed side effect', async (t) => {
  const cases = [
    ['input_prepared', 'extract-audio'],
    ['audio_extracted', 'demucs'],
    ['voice_separated', 'build-vocal-only-video'],
    ['speech_analyzed', 'persist:translated'],
    ['translated', 'child:tts:0:create'],
    ['tts_generating', 'align'],
    ['audio_aligned', 'mix'],
  ];
  for (const [stage, expectedFirst] of cases) {
    const harness = await createHarness({
      job: createParentJob({
        result: { voiceoverCheckpoint: checkpointAt(stage) },
      }),
      overrides: {
        resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
          const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
          await mkdir(path.dirname(destinationPath), { recursive: true });
          await writeFile(destinationPath, requestedId);
          return {
            assetId: requestedId,
            url: requestedId === 'asset-final' ? 'managed-final-url' : `managed://${requestedId}`,
            path: destinationPath,
            userId,
            durationMs: requestedId === 'asset-tts-0' ? 900 : 4_000,
            hasAudio: true,
            sizeBytes: 1_024,
            width: 1080,
            height: 1920,
          };
        },
        childJobs: {
          getOrCreate: async () => {
            harness.events.push('child:tts:0:create');
            return {
              id: 'child-tts-0',
              status: 'succeeded',
              providerTaskId: 'provider-tts-0',
              result: {
                assetId: 'asset-tts-0',
                audioUrl: 'managed://asset-tts-0',
                durationMs: 900,
              },
            };
          },
        },
      },
    });
    t.after(harness.cleanup);

    await harness.result();
    const relevant = harness.events.filter((event) => (
      event !== 'cleanup'
      && event !== 'resolve-owned-source'
      && !event.startsWith('persist:')
        ? true
        : event === 'persist:translated'
    ));
    assert.equal(relevant[0], expectedFirst, stage);
  }
});

test('speech_analysis_submitting fails closed without another Gemini call', async (t) => {
  let analysisCalls = 0;
  const harness = await createHarness({
    job: createParentJob({
      result: { voiceoverCheckpoint: checkpointAt('speech_analysis_submitting') },
    }),
    overrides: {
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `https://meiao.example/api/assets/file/${requestedId}/source`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
        };
      },
      analyzeSpeech: async () => {
        analysisCalls += 1;
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_analysis_submission_unknown',
  );
  assert.equal(analysisCalls, 0);
});

test('probes unknown source audio state and only fails immediately on authoritative false', async (t) => {
  let probes = 0;
  const harness = await createHarness({
    overrides: {
      resolveOwnedAsset: async ({ assetId, userId, destinationPath }) => {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, assetId);
        return {
          assetId,
          url: `managed://${assetId}`,
          path: destinationPath,
          userId,
          durationMs: Number.NaN,
        };
      },
      probeMedia: async () => {
        probes += 1;
        return { durationMs: 4_000, hasAudio: true };
      },
    },
  });
  t.after(harness.cleanup);

  const output = await harness.result();
  assert.equal(output.result.voiceoverStage, 'result_persisted');
  assert.equal(probes, 1);
});

test('authoritative no-audio input stops before checkpoint, child, or paid provider work', async (t) => {
  let childCalls = 0;
  let providerCalls = 0;
  const harness = await createHarness({
    overrides: {
      resolveOwnedAsset: async ({ assetId, userId, destinationPath }) => {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, assetId);
        return {
          assetId,
          url: `managed://${assetId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: false,
        };
      },
      probeMedia: async () => {
        throw new Error('authoritative false must not be reprobed');
      },
      childJobs: {
        getOrCreate: async () => {
          childCalls += 1;
        },
      },
      analyzeSpeech: async () => {
        providerCalls += 1;
      },
      runTts: async () => {
        providerCalls += 1;
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_source_has_no_audio',
  );
  assert.equal(harness.checkpoints.length, 0);
  assert.equal(childCalls, 0);
  assert.equal(providerCalls, 0);
});

test('analysis safety failures stop before TTS children or provider calls', async (t) => {
  const cases = [
    ['{not-json', 'voiceover_analysis_invalid'],
    [jsonAnalysis({ ...VALID_ANALYSIS, speakerCount: 0, segments: [] }), 'voiceover_no_speech_detected'],
    [jsonAnalysis({ ...VALID_ANALYSIS, speakerCount: 2 }), 'voiceover_multiple_speakers'],
    [jsonAnalysis({ ...VALID_ANALYSIS, sourceLanguage: 'zz' }), 'voiceover_language_unsupported'],
  ];
  for (const [analysisContent, expectedCode] of cases) {
    let childCalls = 0;
    let ttsCalls = 0;
    const harness = await createHarness({
      analysisContent,
      overrides: {
        childJobs: {
          getOrCreate: async () => {
            childCalls += 1;
          },
        },
        runTts: async () => {
          ttsCalls += 1;
        },
      },
    });
    t.after(harness.cleanup);
    await assert.rejects(
      harness.result(),
      (error) => error?.code === expectedCode,
      expectedCode,
    );
    assert.equal(childCalls, 0, expectedCode);
    assert.equal(ttsCalls, 0, expectedCode);
  }
});

test('local process and final persistence failures clean the work root without advancing state', async (t) => {
  const cases = [
    {
      stage: 'audio_extracted',
      code: 'voiceover_separation_timeout',
      overrides: {
        separateVoice: async () => {
          throw Object.assign(new Error('separation timeout'), {
            code: 'voiceover_separation_timeout',
          });
        },
      },
    },
    {
      stage: 'tts_generating',
      code: 'voiceover_timing_out_of_range',
      overrides: {
        alignAudio: async () => {
          throw Object.assign(new Error('timing invalid'), {
            code: 'voiceover_timing_out_of_range',
          });
        },
      },
    },
    {
      stage: 'audio_aligned',
      code: 'voiceover_mix_failed',
      overrides: {
        mixAudio: async () => {
          throw Object.assign(new Error('mix failed'), {
            code: 'voiceover_mix_failed',
          });
        },
      },
    },
    {
      stage: 'audio_aligned',
      code: 'voiceover_result_persist_failed',
      overrides: {
        mixAudio: async ({ outputPath }) => {
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, 'final');
        },
        persistManagedFile: async () => {
          throw new Error('storage unavailable');
        },
      },
    },
  ];
  for (const item of cases) {
    const harness = await createHarness({
      job: createParentJob({
        result: { voiceoverCheckpoint: checkpointAt(item.stage) },
      }),
      overrides: {
        resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
          const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
          await mkdir(path.dirname(destinationPath), { recursive: true });
          await writeFile(destinationPath, requestedId);
          return {
            assetId: requestedId,
            url: `managed://${requestedId}`,
            path: destinationPath,
            userId,
            durationMs: requestedId === 'asset-tts-0' ? 900 : 4_000,
            hasAudio: true,
            sizeBytes: 1_024,
            width: 1080,
            height: 1920,
          };
        },
        ...item.overrides,
      },
    });
    t.after(harness.cleanup);
    await assert.rejects(
      harness.result(),
      (error) => error?.code === item.code,
      item.code,
    );
    assert.equal(harness.events.at(-1), 'cleanup', item.code);
    assert.notEqual(harness.checkpoints.at(-1)?.stage, 'result_persisted', item.code);
  }
});

test('corrupt resumed TTS audio stops before the next paid child attempt', async (t) => {
  const firstSegment = {
    id: 's1',
    startMs: 0,
    endMs: 1_000,
    sourceText: '第一段',
    targetText: 'First segment',
  };
  const secondSegment = {
    id: 's2',
    startMs: 1_200,
    endMs: 2_200,
    sourceText: '第二段',
    targetText: 'Second segment',
  };
  const checkpoint = checkpointAt('tts_generating');
  checkpoint.analysis = {
    ...checkpoint.analysis,
    segments: [firstSegment, secondSegment],
  };
  checkpoint.translation = {
    ...checkpoint.translation,
    segments: [firstSegment, secondSegment],
  };
  checkpoint.ttsGroups = [{
    index: 0,
    attempt: 0,
    childJobId: 'child-tts-0',
    providerTaskId: 'provider-tts-0',
    assetId: 'asset-tts-corrupt',
    status: 'succeeded',
    startMs: 0,
    endMs: 1_000,
    actualDurationMs: 900,
  }];
  let paidCalls = 0;
  const harness = await createHarness({
    job: createParentJob({
      result: { voiceoverCheckpoint: checkpoint },
    }),
    overrides: {
      buildTtsGroups: () => ([
        {
          groupIndex: 0,
          startMs: 0,
          endMs: 1_000,
          dialogueTurns: [{ speaker: 'Speaker 1', text: 'First segment' }],
          scene: 'First',
          sampleContext: 'First',
        },
        {
          groupIndex: 1,
          startMs: 1_200,
          endMs: 2_200,
          dialogueTurns: [{ speaker: 'Speaker 1', text: 'Second segment' }],
          scene: 'Second',
          sampleContext: 'Second',
        },
      ]),
      resolveOwnedAsset: async ({
        assetId,
        sourceUrl,
        userId,
        destinationPath,
        expectedKind,
      }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        if (requestedId === 'asset-tts-corrupt' && expectedKind === 'tts_audio') {
          throw Object.assign(new Error('wrong media type'), {
            code: 'voiceover_checkpoint_asset_invalid',
          });
        }
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
          sizeBytes: 1_024,
          width: 1080,
          height: 1920,
        };
      },
      runTts: async () => {
        paidCalls += 1;
        throw new Error('must not create the next paid attempt');
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
  assert.equal(paidCalls, 0);
});

test('legacy merged TTS checkpoints fail closed before reusing a mismatched segment attempt', async (t) => {
  const firstSegment = {
    id: 's1',
    startMs: 0,
    endMs: 1_000,
    sourceText: '第一段',
    targetText: 'First segment',
  };
  const secondSegment = {
    id: 's2',
    startMs: 1_200,
    endMs: 2_200,
    sourceText: '第二段',
    targetText: 'Second segment',
  };
  const checkpoint = checkpointAt('tts_generating');
  checkpoint.analysis = {
    ...checkpoint.analysis,
    segments: [firstSegment, secondSegment],
  };
  checkpoint.translation = {
    ...checkpoint.translation,
    segments: [firstSegment, secondSegment],
  };
  checkpoint.ttsGroups[0].endMs = 2_200;
  let childReads = 0;
  const harness = await createHarness({
    job: createParentJob({
      result: { voiceoverCheckpoint: checkpoint },
    }),
    overrides: {
      buildTtsGroups: () => ([
        {
          groupIndex: 0,
          startMs: 0,
          endMs: 1_000,
          dialogueTurns: [{ speaker: 'Speaker 1', text: 'First segment' }],
          scene: 'First',
          sampleContext: 'First',
        },
        {
          groupIndex: 1,
          startMs: 1_200,
          endMs: 2_200,
          dialogueTurns: [{ speaker: 'Speaker 1', text: 'Second segment' }],
          scene: 'Second',
          sampleContext: 'Second',
        },
      ]),
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
          sizeBytes: 1_024,
          width: 1080,
          height: 1920,
        };
      },
      childJobs: {
        getOrCreate: async () => {
          childReads += 1;
          throw new Error('must not reuse a mismatched legacy attempt');
        },
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_checkpoint_invalid',
  );
  assert.equal(childReads, 0);
});

test('wrong-type persisted final video is rejected instead of returned as playable', async (t) => {
  const checkpoint = checkpointAt('result_persisted');
  let mixCalls = 0;
  const harness = await createHarness({
    job: createParentJob({
      result: { voiceoverCheckpoint: checkpoint },
    }),
    overrides: {
      resolveOwnedAsset: async ({
        assetId,
        sourceUrl,
        userId,
        destinationPath,
        expectedKind,
      }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        if (expectedKind === 'final_video') {
          await probeVoiceoverManagedMedia({
            filePath: destinationPath,
            expectedKind,
            probe: async () => ({
              durationSeconds: 4,
              sizeBytes: 4096,
              formatNames: ['mov', 'mp4'],
              containerBrand: 'isom',
              videoCodec: 'hevc',
              pixelFormat: 'yuv420p',
              width: 1080,
              height: 1920,
              audioCodec: 'mp3',
              sampleRate: 44100,
              channels: 2,
              hasVideo: true,
              hasAudio: true,
              fastStart: false,
            }),
          });
        }
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
          sizeBytes: 1_024,
          width: 1080,
          height: 1920,
        };
      },
      mixAudio: async () => {
        mixCalls += 1;
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
  assert.equal(mixCalls, 0);
});

test('cancellation before paid work creates no checkpoint or child and still cleans', async (t) => {
  let childCalls = 0;
  let paidCalls = 0;
  const controller = new AbortController();
  controller.abort();
  const harness = await createHarness({
    overrides: {
      childJobs: {
        getOrCreate: async () => {
          childCalls += 1;
        },
      },
      analyzeSpeech: async () => {
        paidCalls += 1;
      },
      runTts: async () => {
        paidCalls += 1;
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(controller.signal),
    (error) => error?.code === 'request_cancelled',
  );
  assert.equal(harness.checkpoints.length, 0);
  assert.equal(childCalls, 0);
  assert.equal(paidCalls, 0);
  assert.equal(harness.events.at(-1), 'cleanup');
});

test('redacting logger never receives transcript, provider URL, or local path', async (t) => {
  const logs = [];
  const harness = await createHarness({
    overrides: {
      logger: {
        info: (entry) => logs.push(entry),
        error: (entry) => logs.push(entry),
      },
    },
  });
  t.after(harness.cleanup);

  await harness.result();
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /源文|Translation|provider\.example|voiceover-task9-test|authorization|apiKey/i);
  assert.ok(logs.every((entry) => (
    Object.keys(entry).every((key) => [
      'event',
      'jobId',
      'childJobId',
      'providerTaskId',
      'stage',
      'durationMs',
      'errorCode',
    ].includes(key))
  )));
});

test('recovers Golden success from the child ledger after a parent-checkpoint crash without rerunning Golden', async (t) => {
  let goldenCalls = 0;
  let extractedFrom = '';
  const job = createParentJob({
    payload: {
      removeText: true,
      subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
    },
    result: { voiceoverCheckpoint: checkpointAt('input_prepared') },
  });
  const harness = await createHarness({
    job,
    overrides: {
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
          ...(requestedId === 'asset-source'
            ? {}
            : { sizeBytes: 1_024, width: 1080, height: 1920 }),
        };
      },
      probeMedia: async () => ({
        durationMs: 4_000,
        hasAudio: true,
        sizeBytes: 1_024,
        width: 1080,
        height: 1920,
      }),
      childJobs: {
        getOrCreate: async ({ childKey }) => {
          if (childKey.startsWith('golden:')) {
            return {
              id: 'child-golden-0',
              status: 'succeeded',
              providerTaskId: 'provider-golden-0',
              result: {
                assetId: 'asset-golden',
                resultAssetId: 'asset-golden',
                videoUrl: 'managed://asset-golden',
                durationMs: 4_000,
              },
            };
          }
          return {
            id: 'child-tts-0',
            status: 'succeeded',
            providerTaskId: 'provider-tts-0',
            result: {
              assetId: 'asset-tts-0',
              audioUrl: 'managed://asset-tts-0',
              durationMs: 900,
            },
          };
        },
      },
      runGolden: async () => {
        goldenCalls += 1;
        throw new Error('must not rerun Golden');
      },
      extractAudio: async ({ inputVideoPath, outputWavPath }) => {
        extractedFrom = String(await import('node:fs/promises').then(({ readFile }) => readFile(inputVideoPath, 'utf8')));
        await mkdir(path.dirname(outputWavPath), { recursive: true });
        await writeFile(outputWavPath, 'audio');
      },
    },
  });
  t.after(harness.cleanup);

  const output = await harness.result();
  assert.equal(output.result.videoUrl, 'managed-final-url');
  assert.equal(goldenCalls, 0);
  assert.equal(extractedFrom, 'asset-golden');
  assert.equal(harness.checkpoints.find((item) => item.stage === 'subtitle_removal')?.subtitleRemoval?.resultAssetId, 'asset-golden');
  assert.equal(harness.checkpoints.at(-1).baseVideoAssetId, 'asset-source');
});

test('runner creates and completes TTS through the real local child ledger contract', async (t) => {
  const job = createParentJob();
  const store = { jobs: [structuredClone(job)] };
  let childSequence = 0;
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => `real-child-${++childSequence}`,
    now: (() => {
      let value = 10_000;
      return () => ++value;
    })(),
    env: { MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1' },
  });
  const harness = await createHarness({
    job,
    overrides: { childJobs },
  });
  t.after(harness.cleanup);

  const output = await harness.result();
  const child = store.jobs.find((item) => item.taskType === 'kie_tts');

  assert.equal(output.result.voiceoverStage, 'result_persisted');
  assert.equal(child?.status, 'succeeded');
  assert.equal(child?.payload?.childKey, 'tts:0:attempt:0');
  assert.equal(child?.result?.assetId, 'asset-tts-0');
});

test('runner creates Golden and TTS children through the real local ledger contract', async (t) => {
  const job = createParentJob({
    payload: {
      removeText: true,
      subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
    },
  });
  const store = { jobs: [structuredClone(job)] };
  let childSequence = 0;
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => `real-child-${++childSequence}`,
    now: (() => {
      let value = 20_000;
      return () => ++value;
    })(),
    env: { MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1' },
  });
  const harness = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
          ...(requestedId === 'asset-source'
            ? {}
            : { sizeBytes: 1_024, width: 1080, height: 1920 }),
        };
      },
      probeMedia: async () => ({
        durationMs: 4_000,
        hasAudio: true,
        sizeBytes: 1_024,
        width: 1080,
        height: 1920,
      }),
      runGolden: async ({ onProviderTaskId }) => {
        await onProviderTaskId('provider-golden-0');
        return {
          providerTaskId: 'provider-golden-0',
          result: { videoUrl: 'https://provider.example/golden.mp4' },
        };
      },
      persistGoldenOutput: async () => ({
        assetId: 'asset-golden',
        url: 'https://meiao.example/api/assets/file/asset-golden/result.mp4',
        durationMs: 4_000,
      }),
      persistTtsOutput: async () => ({
        audioUrl: 'http://127.0.0.1:3000/api/assets/file/asset-tts-0/audio.mp3',
        audioUrlAssetId: 'asset-tts-0',
        durationMs: 900,
      }),
    },
  });
  t.after(harness.cleanup);

  const output = await harness.result();
  const children = store.jobs.filter((item) => item.payload?.executionOwner === 'parent');

  assert.equal(output.result.voiceoverStage, 'result_persisted');
  assert.equal(
    children.find((item) => item.taskType === 'subtitle_remove_video')?.payload?.sourceUrl,
    'managed://asset-source',
  );
  assert.equal(
    children.find((item) => item.taskType === 'subtitle_remove_video')?.result?.videoUrl,
    'managed://asset-golden',
  );
  assert.equal(
    children.find((item) => item.taskType === 'kie_tts')?.result?.audioUrl,
    'managed://asset-tts-0',
  );
  assert.deepEqual(
    children.map((item) => [item.taskType, item.payload.childKey, item.status]).sort(),
    [
      ['kie_tts', 'tts:0:attempt:0', 'succeeded'],
      ['subtitle_remove_video', 'golden:attempt:0', 'succeeded'],
    ],
  );
});

test('definitive Golden failure is durable and a confirmed retry advances to attempt one', async (t) => {
  const job = createParentJob({
    payload: {
      removeText: true,
      subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
    },
  });
  const store = { jobs: [structuredClone(job)] };
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => 'real-golden-failed-0',
    now: (() => {
      let value = 25_000;
      return () => ++value;
    })(),
  });
  const harness = await createHarness({
    job,
    overrides: {
      childJobs,
      runGolden: async () => {
        throw Object.assign(new Error('Golden rejected the task'), {
          code: 'provider_job_failed',
        });
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'provider_job_failed',
  );
  const failedCheckpoint = harness.checkpoints.at(-1);
  assert.equal(failedCheckpoint.subtitleRemoval.status, 'failed');
  const failedParent = {
    ...job,
    status: 'failed',
    errorCode: 'provider_job_failed',
    result: { voiceoverCheckpoint: failedCheckpoint },
  };
  const retryPlan = deriveVoiceoverRetryPlan(failedParent, {
    confirmNewProviderAttempt: true,
  });
  const retryResult = prepareVoiceoverJobRetryResult(failedParent, retryPlan);
  assert.deepEqual(retryResult.voiceoverCheckpoint.subtitleRemoval, {
    childJobId: retryPlan.nextChildJobId,
    attempt: 1,
    status: 'queued',
  });
});

test('Golden replay backfills a failed child that committed before its parent checkpoint', async (t) => {
  const job = createParentJob({
    payload: {
      removeText: true,
      subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
    },
    result: { voiceoverCheckpoint: checkpointAt('input_prepared') },
  });
  let providerCalls = 0;
  const harness = await createHarness({
    job,
    overrides: {
      childJobs: {
        getOrCreate: async () => ({
          id: 'golden-failed-before-parent',
          status: 'failed',
          providerTaskId: 'provider-golden-failed',
          errorCode: 'provider_job_failed',
          errorMessage: 'Golden failed',
        }),
      },
      runGolden: async () => {
        providerCalls += 1;
        throw new Error('must not resubmit a failed Golden child');
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'provider_job_failed',
  );
  assert.equal(providerCalls, 0);
  assert.deepEqual(harness.checkpoints.at(-1).subtitleRemoval, {
    childJobId: 'golden-failed-before-parent',
    providerTaskId: 'provider-golden-failed',
    attempt: 0,
    status: 'failed',
  });
});

test('recovers a real-ledger TTS success after the child commit wins the parent-checkpoint race', async (t) => {
  const job = createParentJob({
    result: { voiceoverCheckpoint: checkpointAt('translated') },
  });
  const store = { jobs: [structuredClone(job)] };
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => 'real-child-committed',
    now: (() => {
      let value = 30_000;
      return () => ++value;
    })(),
  });
  let child = await childJobs.getOrCreate({
    parentJob: job,
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: {
      groupIndex: 0,
      targetLanguage: 'en',
      voiceName: 'Kore',
      dialogueTurns: [{ speaker: 'Speaker 1', text: 'Translation' }],
      temperature: 1,
      scene: 'Translated product voiceover with natural, controlled pacing.',
      sampleContext: 'Use one consistent narrator and preserve punctuation and pauses.',
    },
  });
  child = await childJobs.checkpointProviderTaskId(child.id, 'provider-tts-committed');
  await childJobs.markSucceeded(child.id, {
    assetId: 'asset-tts-0',
    audioUrl: 'managed://asset-tts-0',
    durationMs: 900,
  });
  let providerCalls = 0;
  const harness = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: requestedId === 'asset-tts-0' ? 900 : 4_000,
          hasAudio: true,
          sizeBytes: 1_024,
          width: 1080,
          height: 1920,
        };
      },
      runTts: async () => {
        providerCalls += 1;
        throw new Error('must not query or create');
      },
      persistTtsOutput: async () => {
        throw new Error('must not persist twice');
      },
    },
  });
  t.after(harness.cleanup);

  const output = await harness.result();
  assert.equal(output.result.voiceoverStage, 'result_persisted');
  assert.equal(providerCalls, 0);
  assert.equal(
    harness.checkpoints.find((item) => item.stage === 'tts_generating')?.ttsGroups?.[0]?.assetId,
    'asset-tts-0',
  );
});

test('replay backfills a failed durable TTS child before deriving attempt one', async (t) => {
  const job = createParentJob({
    result: { voiceoverCheckpoint: checkpointAt('translated') },
  });
  const store = { jobs: [structuredClone(job)] };
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => 'real-child-failed-before-parent',
    now: (() => {
      let value = 32_000;
      return () => ++value;
    })(),
  });
  const child = await childJobs.getOrCreate({
    parentJob: job,
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: {
      groupIndex: 0,
      targetLanguage: 'en',
      voiceName: 'Kore',
      dialogueTurns: [{ speaker: 'Speaker 1', text: 'Translation' }],
      temperature: 1,
      scene: 'Translated product voiceover with natural, controlled pacing.',
      sampleContext: 'Use one consistent narrator and preserve punctuation and pauses.',
    },
  });
  await childJobs.markFailed(child.id, Object.assign(new Error('provider failed'), {
    code: 'provider_job_failed',
  }));
  let providerCalls = 0;
  const harness = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
          sizeBytes: 1_024,
          width: 1080,
          height: 1920,
        };
      },
      runTts: async () => {
        providerCalls += 1;
        throw new Error('must not resubmit a failed durable child');
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'provider_job_failed',
  );
  assert.equal(providerCalls, 0);
  const reconciledCheckpoint = harness.checkpoints.at(-1);
  assert.equal(reconciledCheckpoint.stage, 'tts_generating');
  assert.deepEqual(
    reconciledCheckpoint.ttsGroups.map(({ index, attempt, childJobId, status }) => ({
      index,
      attempt,
      childJobId,
      status,
    })),
    [{
      index: 0,
      attempt: 0,
      childJobId: child.id,
      status: 'failed',
    }],
  );
  const failedParent = {
    ...job,
    status: 'failed',
    errorCode: 'provider_job_failed',
    result: { voiceoverCheckpoint: reconciledCheckpoint },
  };
  const retryPlan = deriveVoiceoverRetryPlan(failedParent, {
    confirmNewProviderAttempt: true,
  });
  assert.equal(retryPlan.kind, 'provider');
  assert.equal(retryPlan.target, 'tts');
  assert.equal(retryPlan.groupIndex, 0);
  assert.equal(
    prepareVoiceoverJobRetryResult(failedParent, retryPlan)
      .voiceoverCheckpoint.ttsGroups.at(-1).attempt,
    1,
  );
});

test('TTS cancellation before provider create stays queued and resumes the same attempt once', async (t) => {
  const job = createParentJob({
    result: { voiceoverCheckpoint: checkpointAt('translated') },
  });
  const store = { jobs: [structuredClone(job)] };
  let childSequence = 0;
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => `real-before-create-${++childSequence}`,
    now: (() => {
      let value = 35_000;
      return () => ++value;
    })(),
  });
  const resolveOwnedAsset = async ({ assetId, sourceUrl, userId, destinationPath }) => {
    const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, requestedId);
    return {
      assetId: requestedId,
      url: `managed://${requestedId}`,
      path: destinationPath,
      userId,
      durationMs: requestedId === 'asset-tts-0' ? 900 : 4_000,
      hasAudio: true,
      sizeBytes: 1_024,
      width: 1080,
      height: 1920,
    };
  };
  let paidCreates = 0;
  const first = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset,
      runTts: async () => {
        throw Object.assign(new Error('cancelled before POST'), {
          code: 'request_cancelled',
          cancelled: true,
        });
      },
    },
  });
  t.after(first.cleanup);

  await assert.rejects(
    first.result(),
    (error) => error?.code === 'request_cancelled',
  );
  const queuedCheckpoint = first.checkpoints.at(-1);
  assert.equal(queuedCheckpoint.ttsGroups[0].status, 'queued');
  assert.equal(queuedCheckpoint.ttsGroups[0].providerTaskId, undefined);
  const reusableResult = prepareVoiceoverJobRetryResult({
    ...job,
    status: 'cancelled',
    errorCode: 'request_cancelled',
    result: { voiceoverCheckpoint: queuedCheckpoint },
  }, { kind: 'reuse' });
  assert.equal(reusableResult.voiceoverCheckpoint.ttsGroups[0].attempt, 0);
  job.result = reusableResult;
  const parentIndex = store.jobs.findIndex((item) => item.id === job.id);
  store.jobs[parentIndex] = structuredClone(job);

  const second = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset,
      runTts: async ({ onProviderTaskId }) => {
        paidCreates += 1;
        await onProviderTaskId('provider-before-create');
        return {
          providerTaskId: 'provider-before-create',
          result: { audioUrl: 'https://provider.example/once.mp3' },
        };
      },
    },
  });
  t.after(second.cleanup);

  const output = await second.result();
  assert.equal(output.result.voiceoverStage, 'result_persisted');
  assert.equal(paidCreates, 1);
  assert.equal(
    store.jobs.filter((item) => item.taskType === 'kie_tts').length,
    1,
  );
});

test('cancellation after TTS provider id restarts query-only on the same attempt', async (t) => {
  const job = createParentJob({
    result: { voiceoverCheckpoint: checkpointAt('translated') },
  });
  const store = { jobs: [structuredClone(job)] };
  let childSequence = 0;
  const childJobs = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: () => store,
    mutateLocalStore: async (operation) => operation(store),
    createJobId: () => `real-restart-child-${++childSequence}`,
    now: (() => {
      let value = 40_000;
      return () => ++value;
    })(),
  });
  const resolveOwnedAsset = async ({ assetId, sourceUrl, userId, destinationPath }) => {
    const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, requestedId);
    return {
      assetId: requestedId,
      url: `managed://${requestedId}`,
      path: destinationPath,
      userId,
      durationMs: requestedId === 'asset-tts-0' ? 900 : 4_000,
      hasAudio: true,
      sizeBytes: 1_024,
      width: 1080,
      height: 1920,
    };
  };
  let paidCreates = 0;
  let queries = 0;
  const first = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset,
      runTts: async ({ job: child, onProviderTaskId }) => {
        assert.equal(child.providerTaskId, '');
        paidCreates += 1;
        await onProviderTaskId('provider-tts-restart');
        throw Object.assign(new Error('cancelled after provider id'), {
          code: 'request_cancelled',
          cancelled: true,
          providerTaskId: 'provider-tts-restart',
        });
      },
    },
  });
  t.after(first.cleanup);

  await assert.rejects(
    first.result(),
    (error) => error?.code === 'request_cancelled',
  );
  const submittedCheckpoint = first.checkpoints.at(-1);
  assert.equal(submittedCheckpoint.ttsGroups[0].providerTaskId, 'provider-tts-restart');
  const reusableResult = prepareVoiceoverJobRetryResult({
    ...job,
    status: 'cancelled',
    errorCode: 'request_cancelled',
    result: { voiceoverCheckpoint: submittedCheckpoint },
  }, { kind: 'reuse' });
  job.result = reusableResult;
  const parentIndex = store.jobs.findIndex((item) => item.id === job.id);
  store.jobs[parentIndex] = structuredClone(job);

  const second = await createHarness({
    job,
    overrides: {
      childJobs,
      resolveOwnedAsset,
      runTts: async ({ job: child }) => {
        assert.equal(child.providerTaskId, 'provider-tts-restart');
        queries += 1;
        return {
          providerTaskId: child.providerTaskId,
          result: { audioUrl: 'https://provider.example/recovered.mp3' },
        };
      },
    },
  });
  t.after(second.cleanup);

  const output = await second.result();
  assert.equal(output.result.voiceoverStage, 'result_persisted');
  assert.equal(paidCreates, 1);
  assert.equal(queries, 1);
  assert.equal(
    store.jobs.filter((item) => item.taskType === 'kie_tts').length,
    1,
  );
});

test('cleans an owned work root when canonicalization fails before runner setup completes', async (t) => {
  const ownedRoot = await mkdtemp(path.join(os.tmpdir(), 'voiceover-root-failure-'));
  let cleaned = '';
  const harness = await createHarness({
    overrides: {
      createWorkRoot: async () => {
        await rm(ownedRoot, { recursive: true, force: true });
        return ownedRoot;
      },
      cleanupWorkRoot: async (candidate) => {
        cleaned = candidate;
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_work_path_invalid',
  );
  assert.equal(cleaned, ownedRoot);
});

test('missing child ledger fails with a structured availability error before TTS', async (t) => {
  const harness = await createHarness({
    job: createParentJob({
      result: { voiceoverCheckpoint: checkpointAt('translated') },
    }),
    overrides: {
      childJobs: null,
      resolveOwnedAsset: async ({ assetId, sourceUrl, userId, destinationPath }) => {
        const requestedId = assetId || String(sourceUrl || '').replace(/^managed:\/\//u, '');
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, requestedId);
        return {
          assetId: requestedId,
          url: `managed://${requestedId}`,
          path: destinationPath,
          userId,
          durationMs: 4_000,
          hasAudio: true,
        };
      },
    },
  });
  t.after(harness.cleanup);

  await assert.rejects(
    harness.result(),
    (error) => error?.code === 'voiceover_unavailable',
  );
});

test('canonical work-root validation rejects traversal, relative, sibling-prefix, and symlink escapes', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'voiceover-path-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'job-root');
  const sibling = path.join(parent, 'job-root-escape');
  const outside = path.join(parent, 'outside');
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await mkdir(sibling);
  await mkdir(outside);
  await writeFile(path.join(root, 'nested', 'ok.wav'), 'ok');
  await writeFile(path.join(sibling, 'bad.wav'), 'bad');
  await writeFile(path.join(outside, 'bad.wav'), 'bad');
  await symlink(outside, path.join(root, 'link'));

  const canonicalRoot = await realpath(root);
  assert.equal(
    await assertVoiceoverWorkPath(canonicalRoot, path.join(root, 'nested', 'ok.wav'), { mustExist: true }),
    path.join(canonicalRoot, 'nested', 'ok.wav'),
  );
  for (const candidate of [
    'nested/ok.wav',
    path.join(root, '..', 'outside', 'bad.wav'),
    path.join(sibling, 'bad.wav'),
    path.join(root, 'link', 'bad.wav'),
  ]) {
    await assert.rejects(
      assertVoiceoverWorkPath(canonicalRoot, candidate, { mustExist: true }),
      (error) => error?.code === 'voiceover_work_path_invalid',
      candidate,
    );
  }
});

test('awaits a process close permit before work-root cleanup and preserves the original error', async (t) => {
  const order = [];
  let releaseClose;
  const releasePermitWhenClosed = new Promise((resolve) => {
    releaseClose = () => {
      order.push('process-closed');
      resolve();
    };
  });
  const original = Object.assign(new Error('separation timed out'), {
    code: 'voiceover_separation_timeout',
  });
  let notifySeparationEntered;
  const separationEntered = new Promise((resolve) => {
    notifySeparationEntered = resolve;
  });
  Object.defineProperty(original, 'releasePermitWhenClosed', {
    value: releasePermitWhenClosed,
    enumerable: false,
  });
  const harness = await createHarness({
    overrides: {
      separateVoice: async () => {
        order.push('separation-failed');
        notifySeparationEntered();
        throw original;
      },
      cleanupWorkRoot: async () => {
        order.push('cleanup');
        throw new Error('cleanup also failed');
      },
    },
  });
  t.after(harness.cleanup);

  const pending = harness.result();
  await separationEntered;
  assert.deepEqual(order, ['separation-failed']);
  releaseClose();
  await assert.rejects(pending, (error) => error === original);
  assert.deepEqual(order, ['separation-failed', 'process-closed', 'cleanup']);
});
