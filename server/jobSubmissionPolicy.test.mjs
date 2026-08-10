import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAuthorizedProviderTaskRecoverySource,
  canRecoverProviderTaskById,
  getJobSubmissionLockTimeoutSeconds,
  RECOVERABLE_PROVIDER_TASK_TYPES,
  resolveJobSubmissionPolicy,
  VIDEO_JOB_TASK_TYPES,
} from './jobSubmissionPolicy.mjs';

const KIE_TASK_TYPES = [
  'kie_chat',
  'kie_image',
  'kie_probe',
  'kie_recover',
  'kie_seedance_video',
  'kie_veo',
  'kie_video',
];

test('provider policy rejects internal provider for every KIE task type', () => {
  for (const taskType of KIE_TASK_TYPES) {
    assert.throws(
      () => resolveJobSubmissionPolicy({ taskType, provider: 'internal', hasVideoPermission: true }),
      (error) => error?.code === 'job_provider_not_allowed' && error?.statusCode === 400,
      taskType
    );
  }
});

test('provider policy binds Dreamina video jobs to the Dreamina provider', () => {
  assert.equal(
    resolveJobSubmissionPolicy({
      taskType: 'dreamina_video',
      provider: 'dreamina',
      hasVideoPermission: true,
    }).provider,
    'dreamina'
  );

  for (const provider of ['internal', 'kie']) {
    assert.throws(
      () => resolveJobSubmissionPolicy({ taskType: 'dreamina_video', provider, hasVideoPermission: true }),
      (error) => error?.code === 'job_provider_not_allowed'
    );
  }
});

test('video permission and create retry policy covers every video task type', () => {
  assert.deepEqual(
    [...VIDEO_JOB_TASK_TYPES].sort(),
    ['dreamina_video', 'kie_seedance_video', 'kie_tts', 'kie_veo', 'kie_video', 'maxforai_video', 'subtitle_remove_video', 'voiceover_translate_video']
  );

  for (const taskType of VIDEO_JOB_TASK_TYPES) {
    const provider = taskType === 'dreamina_video'
      ? 'dreamina'
      : taskType === 'maxforai_video'
        ? 'maxforai'
        : taskType === 'subtitle_remove_video'
          ? 'golden_subtitle'
          : taskType === 'voiceover_translate_video'
            ? 'internal'
        : 'kie';
    const featureOptions = taskType === 'subtitle_remove_video'
      ? {
          subtitleRemovalEnabled: true,
          subtitleRemovalConfigured: true,
          payload: { batchCount: 1, batchIndex: 0 },
        }
      : taskType === 'kie_tts'
        ? {
            trustedParentExecution: true,
            payload: {
              executionOwner: 'parent',
              parentJobId: 'voiceover-parent-1',
              childKey: 'tts:0:attempt:0',
            },
          }
      : taskType === 'voiceover_translate_video'
        ? {
            module: 'video',
            subFeature: 'voiceover_translation',
            payload: {
              taskPurpose: 'voiceover_translation',
              subFeature: 'voiceover_translation',
              removeText: false,
            },
            voiceoverEnabled: true,
            voiceoverKieConfigured: true,
            voiceoverReadiness: {
              pythonReady: true,
              modelReady: true,
              ffmpegReady: true,
            },
            voiceoverSourceProbe: {
              hasAudio: true,
              durationMs: 10_000,
            },
          }
      : {};
    assert.throws(
      () => resolveJobSubmissionPolicy({ taskType, provider, hasVideoPermission: false, ...featureOptions }),
      (error) => error?.code === 'video_feature_forbidden' && error?.statusCode === 403,
      taskType
    );
    const policy = resolveJobSubmissionPolicy({ taskType, provider, hasVideoPermission: true, ...featureOptions });
    assert.equal(policy.maxCreateRetries, 0, taskType);
    assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000, taskType);
  }
});

test('voiceover parent policy is internal-only and consumes trusted server readiness and source probe', () => {
  const ready = {
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    subFeature: 'voiceover_translation',
    payload: {
      taskPurpose: 'voiceover_translation',
      subFeature: 'voiceover_translation',
      removeText: false,
    },
    hasVideoPermission: true,
    voiceoverEnabled: true,
    voiceoverKieConfigured: true,
    voiceoverReadiness: {
      pythonReady: true,
      modelReady: true,
      ffmpegReady: true,
    },
    voiceoverSourceProbe: {
      hasAudio: true,
      durationMs: 20_000,
    },
  };

  const policy = resolveJobSubmissionPolicy(ready);
  assert.equal(policy.provider, 'internal');
  assert.equal(policy.maxCreateRetries, 0);
  assert.equal(policy.requiresVideoPermission, true);
  assert.doesNotThrow(() => resolveJobSubmissionPolicy({
    ...ready,
    submissionOperation: 'retry',
  }));
  assert.throws(
    () => resolveJobSubmissionPolicy({
      ...ready,
      submissionOperation: 'retry',
      voiceoverSourceProbe: {},
    }),
    (error) => error?.code === 'voiceover_source_has_no_audio',
  );
  for (const input of [
    { ...ready, provider: 'kie' },
    { ...ready, module: 'translation' },
    { ...ready, subFeature: 'generation' },
    { ...ready, voiceoverEnabled: false },
    { ...ready, voiceoverKieConfigured: false },
    { ...ready, voiceoverReadiness: { ...ready.voiceoverReadiness, modelReady: false } },
    { ...ready, voiceoverSourceProbe: { hasAudio: false, durationMs: 20_000 } },
  ]) {
    assert.throws(
      () => resolveJobSubmissionPolicy(input),
      (error) => /^voiceover_|job_provider_not_allowed/u.test(String(error?.code || '')),
    );
  }

  assert.throws(
    () => resolveJobSubmissionPolicy({
      ...ready,
      payload: { ...ready.payload, removeText: true },
      subtitleRemovalEnabled: true,
      subtitleRemovalConfigured: true,
      voiceoverSourceProbe: { hasAudio: true, durationMs: 600_001 },
    }),
    (error) => error?.code === 'voiceover_source_too_long',
  );
  assert.doesNotThrow(() => resolveJobSubmissionPolicy({
    ...ready,
    payload: { ...ready.payload, removeText: true },
    subtitleRemovalEnabled: true,
    subtitleRemovalConfigured: true,
    voiceoverSourceProbe: { hasAudio: true, durationMs: 600_000 },
  }));
  assert.throws(
    () => resolveJobSubmissionPolicy({
      ...ready,
      payload: { ...ready.payload, removeText: true },
      subtitleRemovalEnabled: false,
      subtitleRemovalConfigured: true,
    }),
    (error) => error?.code === 'subtitle_removal_unavailable',
  );
});

test('subtitle removal is provider-bound, gated for new work, and recoverable by old task id', () => {
  const input = {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: { subFeature: 'subtitle_removal', batchCount: 1, batchIndex: 0 },
    hasVideoPermission: true,
  };
  const policy = resolveJobSubmissionPolicy({
    ...input,
    subtitleRemovalEnabled: true,
    subtitleRemovalConfigured: true,
  });

  assert.equal(policy.requiresVideoPermission, true);
  assert.equal(policy.maxCreateRetries, 0);
  assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
  assert.equal(canRecoverProviderTaskById({
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    providerTaskId: 'golden-1',
  }), true);
  assert.throws(
    () => resolveJobSubmissionPolicy({ ...input, provider: 'kie', subtitleRemovalEnabled: true, subtitleRemovalConfigured: true }),
    (error) => error?.code === 'job_provider_not_allowed',
  );
  assert.throws(
    () => resolveJobSubmissionPolicy({ ...input, subtitleRemovalEnabled: false, subtitleRemovalConfigured: true }),
    (error) => error?.code === 'subtitle_removal_unavailable' && error?.statusCode === 503,
  );
  assert.throws(
    () => resolveJobSubmissionPolicy({ ...input, subtitleRemovalEnabled: true, subtitleRemovalConfigured: false }),
    (error) => error?.code === 'subtitle_removal_unavailable' && error?.statusCode === 503,
  );
  assert.doesNotThrow(() => resolveJobSubmissionPolicy({
    ...input,
    submissionOperation: 'recover',
    subtitleRemovalEnabled: false,
    subtitleRemovalConfigured: false,
  }));
});

test('subtitle removal batch identity is validated at the authoritative job boundary', () => {
  const input = {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: {
      subFeature: 'subtitle_removal',
      batchId: 'batch-1',
      batchIndex: 1,
      batchCount: 3,
      shellResultId: 'batch-1-result-1',
    },
    hasVideoPermission: true,
    subtitleRemovalEnabled: true,
    subtitleRemovalConfigured: true,
    subtitleRemovalBatchMaxItems: 10,
  };

  assert.doesNotThrow(() => resolveJobSubmissionPolicy(input));
  for (const payload of [
    { ...input.payload, batchCount: 2.5 },
    { ...input.payload, batchCount: 11 },
    { ...input.payload, batchIndex: -1 },
    { ...input.payload, batchIndex: 3 },
    { ...input.payload, batchIndex: 0.5 },
  ]) {
    assert.throws(
      () => resolveJobSubmissionPolicy({ ...input, payload }),
      (error) => error?.code === 'subtitle_batch_invalid' && error?.statusCode === 400,
    );
  }
});

test('historical subtitle retry does not require create-only batch metadata or current rollout', () => {
  const policy = resolveJobSubmissionPolicy({
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: {},
    hasVideoPermission: true,
    submissionOperation: 'retry',
    subtitleRemovalEnabled: false,
    subtitleRemovalConfigured: false,
  });

  assert.equal(policy.taskType, 'subtitle_remove_video');
  assert.equal(policy.provider, 'golden_subtitle');
});

test('MaxForAI video jobs are provider-bound, zero-retry and recoverable by task id', () => {
  const policy = resolveJobSubmissionPolicy({
    module: 'video',
    taskType: 'maxforai_video',
    provider: 'maxforai',
    hasVideoPermission: true,
  });

  assert.equal(policy.requiresVideoPermission, true);
  assert.equal(policy.maxCreateRetries, 0);
  assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
  assert.equal(canRecoverProviderTaskById({
    taskType: 'maxforai_video',
    provider: 'maxforai',
    providerTaskId: 'video_123',
  }), true);
  assert.throws(
    () => resolveJobSubmissionPolicy({
      taskType: 'maxforai_video',
      provider: 'kie',
      hasVideoPermission: true,
    }),
    /\u4e0d\u5141\u8bb8\u4f7f\u7528 provider=kie/
  );
});

test('video storyboard chat receives video permission, zero create retries and video dedupe policy', () => {
  const input = {
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: { subFeature: 'storyboard', planningPurpose: 'storyboard_script' },
  };

  assert.throws(
    () => resolveJobSubmissionPolicy({ ...input, hasVideoPermission: false }),
    (error) => error?.code === 'video_feature_forbidden' && error?.statusCode === 403
  );
  const policy = resolveJobSubmissionPolicy({ ...input, hasVideoPermission: true });
  assert.equal(policy.requiresVideoPermission, true);
  assert.equal(policy.maxCreateRetries, 0);
  assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
});

test('video storyboard image jobs receive zero create retries and video dedupe policy', () => {
  const input = {
    module: 'video',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { subFeature: 'storyboard', planningPurpose: 'storyboard_board_image' },
  };

  assert.throws(
    () => resolveJobSubmissionPolicy({ ...input, hasVideoPermission: false }),
    (error) => error?.code === 'video_feature_forbidden' && error?.statusCode === 403
  );
  const policy = resolveJobSubmissionPolicy({ ...input, hasVideoPermission: true });
  assert.equal(policy.isVideoStoryboard, true);
  assert.equal(policy.maxCreateRetries, 0);
  assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
});

test('provider policy preserves unknown internal tasks for compatibility', () => {
  const policy = resolveJobSubmissionPolicy({
    taskType: 'future_internal_maintenance',
    provider: 'internal',
    hasVideoPermission: false,
  });

  assert.equal(policy.taskType, 'future_internal_maintenance');
  assert.equal(policy.provider, 'internal');
  assert.equal(policy.maxCreateRetries, undefined);
  assert.equal(policy.dedupeWindowMs, 8000);
});

test('provider policy keeps chat dedupe separate from default submissions', () => {
  assert.equal(resolveJobSubmissionPolicy({
    taskType: 'kie_chat',
    provider: 'kie',
    hasVideoPermission: false,
  }).dedupeWindowMs, 3 * 60 * 1000);

  assert.equal(resolveJobSubmissionPolicy({
    taskType: 'kie_image',
    provider: 'kie',
    hasVideoPermission: false,
  }).dedupeWindowMs, 8000);
});

test('submission lock timeout uses an env override with a conservative default', () => {
  assert.equal(getJobSubmissionLockTimeoutSeconds({}), 10);
  assert.equal(getJobSubmissionLockTimeoutSeconds({ MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS: '7' }), 7);
  assert.equal(getJobSubmissionLockTimeoutSeconds({ MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS: '-1' }), 10);
  assert.equal(getJobSubmissionLockTimeoutSeconds({ MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS: 'invalid' }), 10);
});

test('provider task recovery is limited to task types with a real query path', () => {
  const recoverable = [
    ['kie_image', 'kie'],
    ['kie_video', 'kie'],
    ['kie_seedance_video', 'kie'],
    ['kie_tts', 'kie'],
    ['kie_veo', 'kie'],
    ['dreamina_video', 'dreamina'],
    ['maxforai_video', 'maxforai'],
    ['subtitle_remove_video', 'golden_subtitle'],
  ];
  for (const [taskType, provider] of recoverable) {
    assert.equal(canRecoverProviderTaskById({ taskType, provider, providerTaskId: 'existing-task' }), true, taskType);
  }
  for (const taskType of ['kie_chat', 'openai_responses', 'openai_tool_calling']) {
    assert.equal(canRecoverProviderTaskById({ taskType, providerTaskId: 'response-id' }), false, taskType);
  }
  assert.equal(canRecoverProviderTaskById({
    taskType: 'kie_image',
    provider: 'maxforai',
    providerTaskId: 'sync-response-id',
  }), false);
  assert.equal(canRecoverProviderTaskById({
    taskType: 'kie_image',
    provider: 'kie',
    providerTaskId: 'sync-response-id',
    payload: { model: 'maxforai-image-2-relay' },
  }), false);
  assert.equal(canRecoverProviderTaskById({ taskType: 'kie_video', providerTaskId: '' }), false);
  assert.equal(RECOVERABLE_PROVIDER_TASK_TYPES.has('kie_tts'), true);
});

test('parent-owned KIE TTS children require trusted internal policy context', () => {
  const input = {
    module: 'video',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: {
      executionOwner: 'parent',
      parentJobId: 'voiceover-parent-1',
      childKey: 'tts:3:attempt:0',
    },
    hasVideoPermission: true,
  };

  assert.throws(
    () => resolveJobSubmissionPolicy(input),
    (error) => error?.code === 'parent_owned_job_forbidden' && error?.statusCode === 403,
  );
  const policy = resolveJobSubmissionPolicy({
    ...input,
    trustedParentExecution: true,
  });
  assert.equal(policy.requiresVideoPermission, true);
  assert.equal(policy.maxCreateRetries, 0);
  assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
  assert.doesNotThrow(() => resolveJobSubmissionPolicy({
    ...input,
    submissionOperation: 'recover',
    trustedParentExecution: true,
  }));
  assert.doesNotThrow(() => resolveJobSubmissionPolicy({
    ...input,
    payload: {
      ...input.payload,
      childKey: 'tts:continuous:attempt:0',
    },
    trustedParentExecution: true,
  }));

  for (const payload of [
    { ...input.payload, executionOwner: 'browser' },
    { ...input.payload, parentJobId: '' },
    { ...input.payload, childKey: 'tts:3' },
    { ...input.payload, childKey: 'tts:100:attempt:0' },
    { ...input.payload, childKey: 'tts:3:attempt:-1' },
    { ...input.payload, childKey: `tts:3:attempt:${'9'.repeat(40)}` },
  ]) {
    assert.throws(
      () => resolveJobSubmissionPolicy({
        ...input,
        payload,
        trustedParentExecution: true,
      }),
      (error) => error?.code === 'parent_owned_job_invalid' && error?.statusCode === 400,
    );
  }
});

test('parent-owned KIE TTS is not exposed through generic browser recovery', () => {
  const source = {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_tts',
    providerTaskId: 'tts-provider-1',
    payload: {
      executionOwner: 'parent',
      parentJobId: 'voiceover-parent-1',
      childKey: 'tts:0:attempt:0',
    },
  };
  const request = {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_recover',
    providerTaskId: 'tts-provider-1',
    payload: { isVideo: true },
  };

  assert.equal(canRecoverProviderTaskById(source), true);
  assert.equal(isAuthorizedProviderTaskRecoverySource(source, request), false);
});

test('provider task recovery source belongs to the authenticated user and matches KIE media mode', () => {
  const imageSource = {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_image',
    providerTaskId: 'provider-image-1',
  };
  const request = {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_recover',
    providerTaskId: 'provider-image-1',
    payload: { isVideo: false },
  };

  assert.equal(isAuthorizedProviderTaskRecoverySource(imageSource, request), true);
  assert.equal(isAuthorizedProviderTaskRecoverySource(
    { ...imageSource, userId: 'user-2' },
    request,
  ), false, 'another user must not be able to recover the provider task');
  assert.equal(isAuthorizedProviderTaskRecoverySource(
    { ...imageSource, taskType: 'kie_chat' },
    request,
  ), false, 'task types without a query path must stay blocked');
  assert.equal(isAuthorizedProviderTaskRecoverySource(
    { ...imageSource, taskType: 'kie_video' },
    request,
  ), false, 'video provider tasks must not pass an image recovery request');
  assert.equal(isAuthorizedProviderTaskRecoverySource(
    { ...imageSource, providerTaskId: 'provider-image-2' },
    request,
  ), false);
});

test('provider task recovery source accepts a same-user KIE video task only in video mode', () => {
  const source = {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_seedance_video',
    providerTaskId: 'provider-video-1',
  };

  assert.equal(isAuthorizedProviderTaskRecoverySource(source, {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_recover',
    providerTaskId: 'provider-video-1',
    payload: { isVideo: true },
  }), true);
  assert.equal(isAuthorizedProviderTaskRecoverySource(source, {
    userId: 'user-1',
    provider: 'kie',
    taskType: 'kie_recover',
    providerTaskId: 'provider-video-1',
    payload: { isVideo: false },
  }), false);
});

test('paid video submissions use a zero create-retry decision', () => {
  const retryDecision = resolveJobSubmissionPolicy({
    module: 'video',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { subFeature: 'storyboard' },
    hasVideoPermission: true,
  });

  assert.equal(retryDecision.maxCreateRetries, 0);
  assert.equal(retryDecision.dedupeWindowMs, 60 * 60 * 1000);
});
