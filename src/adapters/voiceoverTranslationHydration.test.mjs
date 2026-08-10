import test from 'node:test';
import assert from 'node:assert/strict';

import * as shellDataAdapter from './shellDataAdapter.ts';

const { buildShellDataSnapshot } = shellDataAdapter;

const checkpoint = (stage = 'tts_generating') => ({
  version: 1,
  stage,
  baseVideoAssetId: 'asset-source',
  originalAudioAssetId: 'asset-original-audio',
  vocalAssetId: 'asset-vocal',
  backgroundAssetId: 'asset-background',
  analysisAttempt: 1,
  analysis: {
    sourceLanguage: 'zh-CN',
    speakerCount: 1,
    voiceProfile: {
      pitch: 'medium',
      brightness: 'balanced',
      energy: 'balanced',
      pace: 'natural',
      accentDescription: '普通话',
    },
    segments: [{
      id: 'segment-1',
      startMs: 0,
      endMs: 1000,
      sourceText: '源文',
      targetText: '',
    }],
  },
  translation: {
    targetLanguage: 'en-US',
    mode: 'natural',
    selectedVoiceName: 'Kore',
    segments: [{
      id: 'segment-1',
      startMs: 0,
      endMs: 1000,
      sourceText: '源文',
      targetText: 'Translation',
    }],
  },
  ttsGroups: [{
    index: 0,
    attempt: 0,
    childJobId: 'voiceover-child-tts',
    providerTaskId: 'provider-tts-1',
    status: 'submitted',
    startMs: 0,
    endMs: 1000,
  }],
});

const parentJob = (overrides = {}) => ({
  id: 'voiceover-parent-1',
  userId: 'user-a',
  module: 'video',
  taskType: 'voiceover_translate_video',
  provider: 'internal',
  status: 'running',
  priority: 0,
  payload: {
    taskType: 'voiceover_translate_video',
    taskPurpose: 'voiceover_translation',
    subFeature: 'voiceover_translation',
    userId: 'user-a',
    sourceAssetId: 'asset-source',
    sourceProjectId: 'source-project',
    sourceResultId: 'source-result',
    shellProjectId: 'voiceover-project-1',
    shellProjectName: '口播翻译项目',
    shellResultId: 'voiceover-result-1',
    clientSubmissionKey: 'voiceover-submission-1',
    targetLanguage: 'en-US',
    translationMode: 'natural',
    voiceMode: 'auto',
    removeText: true,
    subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
  },
  providerTaskId: '',
  result: { voiceoverCheckpoint: checkpoint() },
  errorCode: '',
  errorMessage: '',
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_100,
  finishedAt: null,
  cancelRequestedAt: null,
  ...overrides,
});

test('voiceover stage labels match the durable checkpoint contract exactly', () => {
  assert.deepEqual(shellDataAdapter.VOICEOVER_STAGE_LABELS, {
    input_prepared: '准备视频',
    subtitle_removal: '去除画面文案',
    audio_extracted: '提取音频',
    voice_separated: '分离原口播',
    speech_analysis_submitting: '识别原文',
    speech_analyzed: '识别原文',
    translated: '翻译口播',
    tts_generating: '生成新口播',
    audio_aligned: '对齐混音',
    result_persisted: '保存结果',
  });
});

test('running checkpoint hydrates one durable voiceover card with checkpoint metadata', () => {
  const snapshot = buildShellDataSnapshot({ shellProjects: [] }, [parentJob()]);
  assert.equal(snapshot.projects.length, 1);
  const project = snapshot.projects[0];
  const result = project.results[0];
  assert.equal(project.id, 'voiceover-project-1');
  assert.equal(project.module, 'video');
  assert.equal(project.subFeature, 'voiceover_translation');
  assert.equal(project.status, 'generating');
  assert.equal(result.status, 'generating');
  assert.equal(result.statusText, '生成新口播');
  assert.equal(result.voiceoverStage, 'tts_generating');
  assert.equal(result.sourceLanguage, 'zh-CN');
  assert.equal(result.targetLanguage, 'en-US');
  assert.equal(result.translationMode, 'natural');
  assert.equal(result.voiceMode, 'auto');
  assert.equal(result.voiceName, 'Kore');
  assert.equal(result.removeText, true);
  assert.equal(result.sourceTranscript, '源文');
  assert.equal(result.translatedTranscript, 'Translation');
  assert.equal(result.sourceProjectId, 'source-project');
  assert.equal(result.sourceResultId, 'source-result');
  assert.deepEqual(result.subtitleRegionNormalized, { x: 0, y: 0.7, width: 1, height: 0.3 });
  assert.equal(result.voiceoverCheckpoint.ttsGroups[0].providerTaskId, 'provider-tts-1');
  assert.equal(result.backendJobId, 'voiceover-parent-1');
});

test('completed MySQL-style aliases hydrate the final and original managed videos', () => {
  const completedCheckpoint = {
    ...checkpoint('result_persisted'),
    alignedAudioAssetId: 'asset-aligned',
    finalAssetId: 'asset-final',
  };
  const job = parentJob({
    status: 'succeeded',
    result: undefined,
    result_json: JSON.stringify({
      voiceover_checkpoint: completedCheckpoint,
      video_url: '/api/assets/file/asset-final/result.mp4',
      source_url: '/api/assets/file/asset-source/source.mp4',
      source_language: 'zh-CN',
      target_language: 'en-US',
      translation_mode: 'literal',
      voice_mode: 'preset',
      voice_name: 'Kore',
      remove_text: false,
      source_transcript: '<b>源文</b>',
      translated_transcript: '<script>Translation</script>',
      voiceover_stage: 'result_persisted',
      final_asset_id: 'asset-final',
    }),
    provider_task_id: 'parent-provider-id',
    error_code: '',
    error_message: '',
    finished_at: 4_000,
  });

  const project = buildShellDataSnapshot({ shellProjects: [] }, [job]).projects[0];
  const result = project.results[0];
  assert.equal(project.status, 'completed');
  assert.equal(result.status, 'completed');
  assert.equal(result.sourceUrl, '/api/assets/file/asset-source');
  assert.equal(result.videoUrl, '/api/assets/file/asset-final');
  assert.equal(result.finalAssetId, 'asset-final');
  assert.equal(result.translationMode, 'literal');
  assert.equal(result.voiceMode, 'preset');
  assert.equal(result.removeText, false);
  assert.equal(result.sourceTranscript, '<b>源文</b>');
  assert.equal(result.translatedTranscript, '<script>Translation</script>');
  assert.equal(result.taskId, 'parent-provider-id');
});

test('voice and translation modes fail closed outside the canonical contract', () => {
  const jobResult = buildShellDataSnapshot({ shellProjects: [] }, [parentJob({
    result: {
      voiceoverCheckpoint: checkpoint(),
      translationMode: 'creative',
      voiceMode: 'manual',
    },
  })]).projects[0].results[0];
  assert.equal(jobResult.translationMode, undefined);
  assert.equal(jobResult.voiceMode, undefined);

  const persistedResult = buildShellDataSnapshot({
    shellProjects: [{
      id: 'persisted-voiceover-project',
      name: '持久化口播翻译',
      module: 'video',
      subFeature: 'voiceover_translation',
      status: 'completed',
      createdAt: 1_000,
      taskCount: 1,
      completedCount: 1,
      results: [{
        id: 'persisted-voiceover-result',
        projectId: 'persisted-voiceover-project',
        imageUrl: '',
        videoUrl: '/api/assets/file/persisted-final',
        mediaType: 'video',
        prompt: '完成',
        model: 'Gemini 3.1 Flash TTS',
        aspectRatio: 'auto',
        status: 'completed',
        createdAt: 1_000,
        module: 'video',
        subFeature: 'voiceover_translation',
        translationMode: 'creative',
        voiceMode: 'manual',
      }],
    }],
  }, []).projects[0].results[0];
  assert.equal(persistedResult.translationMode, undefined);
  assert.equal(persistedResult.voiceMode, undefined);
});

test('persisted voiceover media rejects unsafe urls and reconstructs canonical managed ids', () => {
  const persistedProject = (result) => ({
    id: 'persisted-voiceover-project',
    name: '持久化口播翻译',
    module: 'video',
    subFeature: 'voiceover_translation',
    status: 'completed',
    createdAt: 1_000,
    taskCount: 1,
    completedCount: 1,
    results: [{
      id: 'persisted-voiceover-result',
      projectId: 'persisted-voiceover-project',
      imageUrl: '',
      mediaType: 'video',
      prompt: '完成',
      model: 'Gemini 3.1 Flash TTS',
      aspectRatio: 'auto',
      status: 'completed',
      createdAt: 1_000,
      module: 'video',
      subFeature: 'voiceover_translation',
      ...result,
    }],
  });

  for (const value of [
    'https://evil.example/video.mp4',
    '//evil.example/video.mp4',
    'https://user:password@meiao.example/api/assets/file/stolen/video.mp4',
    '/api/assets/file/%2e%2e/video.mp4',
  ]) {
    const result = buildShellDataSnapshot({
      shellProjects: [persistedProject({ sourceUrl: value, videoUrl: value })],
    }, []).projects[0].results[0];
    assert.equal(result.sourceUrl, undefined, value);
    assert.equal(result.sourcePreviewUrl, undefined, value);
    assert.equal(result.videoUrl, undefined, value);
  }

  const reconstructed = buildShellDataSnapshot({
    shellProjects: [persistedProject({
      sourceAssetId: 'asset-source-safe',
      finalAssetId: 'asset-final-safe',
    })],
  }, []).projects[0].results[0];
  assert.equal(reconstructed.sourceAssetId, 'asset-source-safe');
  assert.equal(reconstructed.sourceUrl, '/api/assets/file/asset-source-safe');
  assert.equal(reconstructed.sourcePreviewUrl, '/api/assets/file/asset-source-safe');
  assert.equal(reconstructed.finalAssetId, 'asset-final-safe');
  assert.equal(reconstructed.videoUrl, '/api/assets/file/asset-final-safe');
});

test('failed, cancelled and retry-waiting parent states survive refresh', () => {
  const variants = [
    ['failed', 'error', 'provider_job_failed', false],
    ['cancelled', 'error', 'request_cancelled', true],
    ['retry_waiting', 'retry_waiting', 'provider_timeout', false],
  ];
  variants.forEach(([jobStatus, resultStatus, errorCode, cancelled], index) => {
    const job = parentJob({
      id: `voiceover-parent-${index + 2}`,
      status: jobStatus,
      errorCode,
      errorMessage: errorCode,
    });
    const result = buildShellDataSnapshot({ shellProjects: [] }, [job]).projects[0].results[0];
    assert.equal(result.status, resultStatus, jobStatus);
    assert.equal(result.errorCode, errorCode, jobStatus);
    assert.equal(result.cancelled, cancelled, jobStatus);
  });
});

test('only the owned parent row hydrates and child diagnostics never become cards', () => {
  const parent = parentJob();
  const childPayload = {
    executionOwner: 'parent',
    parentJobId: parent.id,
    childKey: 'tts:0:attempt:0',
    clientSubmissionKey: `voiceover-child:${parent.id}:tts:0:attempt:0`,
  };
  const child = (id, taskType, provider) => parentJob({
    id,
    taskType,
    provider,
    payload: childPayload,
    result: null,
  });
  const crossUser = parentJob({
    id: 'voiceover-cross-user',
    payload: { ...parent.payload, shellProjectId: 'cross-user-project', userId: 'user-b' },
  });

  const projects = buildShellDataSnapshot(
    { shellProjects: [] },
    [
      parent,
      child('voiceover-child-tts', 'kie_tts', 'kie'),
      child('voiceover-child-golden', 'subtitle_remove_video', 'golden_subtitle'),
      crossUser,
    ],
  ).projects;
  assert.deepEqual(projects.map((project) => project.id), ['voiceover-project-1']);
});

test('voiceover tombstones prevent deleted cards from reviving', () => {
  const job = parentJob();
  assert.equal(buildShellDataSnapshot({
    shellProjects: [],
    shellDraft: { deletedJobIds: [job.id] },
  }, [job]).projects.length, 0);
  assert.equal(buildShellDataSnapshot({
    shellProjects: [],
    shellDraft: { deletedProjectIds: [job.payload.shellProjectId] },
  }, [job]).projects.length, 0);
});
