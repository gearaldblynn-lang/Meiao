import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getJobSubmissionLockTimeoutSeconds,
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
    ['dreamina_video', 'kie_seedance_video', 'kie_veo', 'kie_video']
  );

  for (const taskType of VIDEO_JOB_TASK_TYPES) {
    const provider = taskType === 'dreamina_video' ? 'dreamina' : 'kie';
    assert.throws(
      () => resolveJobSubmissionPolicy({ taskType, provider, hasVideoPermission: false }),
      (error) => error?.code === 'video_feature_forbidden' && error?.statusCode === 403,
      taskType
    );
    const policy = resolveJobSubmissionPolicy({ taskType, provider, hasVideoPermission: true });
    assert.equal(policy.maxCreateRetries, 0, taskType);
    assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000, taskType);
  }
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
