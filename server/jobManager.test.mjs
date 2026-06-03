import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findReusableJobSubmission,
  reconcileRestartedMysqlJobs,
  reconcileStaleProviderlessRunningMysqlJobs,
  selectJobsWithinConcurrencyLimits,
  shouldMysqlWorkerProcessTaskEngine,
} from './jobManager.mjs';

const createJob = (id, userId, priority = 0, status = 'queued') => ({
  id,
  userId,
  status,
  priority,
  createdAt: Number(id.replace(/\D/g, '')) || 0,
});

test('selectJobsWithinConcurrencyLimits respects global and per-user limits', () => {
  const selected = selectJobsWithinConcurrencyLimits({
    jobs: [
      createJob('job-1', 'user-a', 10),
      createJob('job-2', 'user-a', 9),
      createJob('job-3', 'user-b', 8),
      createJob('job-4', 'user-c', 7),
    ],
    availableSlots: 3,
    activeJobUserIds: ['user-c'],
    getUserConcurrency: (userId) => (userId === 'user-a' ? 1 : userId === 'user-c' ? 1 : 2),
  });

  assert.deepEqual(selected.map((job) => job.id), ['job-1', 'job-3']);
});

test('selectJobsWithinConcurrencyLimits falls back to default concurrency of 5', () => {
  const selected = selectJobsWithinConcurrencyLimits({
    jobs: [
      createJob('job-1', 'user-a', 10),
      createJob('job-2', 'user-a', 9),
      createJob('job-3', 'user-a', 8),
      createJob('job-4', 'user-a', 7),
      createJob('job-5', 'user-a', 6),
      createJob('job-6', 'user-a', 5),
    ],
    availableSlots: 6,
    activeJobUserIds: [],
    getUserConcurrency: () => undefined,
  });

  assert.equal(selected.length, 5);
  assert.deepEqual(selected.map((job) => job.id), ['job-1', 'job-2', 'job-3', 'job-4', 'job-5']);
});

test('mysql worker only processes mysql-backed task engines', () => {
  assert.equal(shouldMysqlWorkerProcessTaskEngine('mysql'), true);
  assert.equal(shouldMysqlWorkerProcessTaskEngine('dual'), true);
  assert.equal(shouldMysqlWorkerProcessTaskEngine('temporal'), false);
  assert.equal(shouldMysqlWorkerProcessTaskEngine('unknown'), true);
});

test('findReusableJobSubmission reuses the newest matching active job in the dedupe window', () => {
  const matched = findReusableJobSubmission({
    jobs: [
      {
        id: 'job-old',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'queued',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 1000,
      },
      {
        id: 'job-new',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'running',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 2000,
      },
      {
        id: 'job-other',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'running',
        payload: { imageUrls: ['other-url'], prompt: 'same prompt' },
        createdAt: 3000,
      },
    ],
    userId: 'user-a',
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
    createdAfter: 1500,
  });

  assert.equal(matched?.id, 'job-new');
});

test('findReusableJobSubmission ignores volatile requestId fields when matching active jobs', () => {
  const matched = findReusableJobSubmission({
    jobs: [
      {
        id: 'job-video',
        userId: 'user-a',
        module: 'video',
        taskType: 'kie_seedance_video',
        provider: 'kie',
        status: 'running',
        payload: {
          requestId: 'old-random-id',
          prompt: 'same prompt',
          imageUrls: ['same-url'],
          nested: { requestId: 'old-nested-id', duration: '12' },
        },
        createdAt: 2000,
      },
    ],
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: {
      requestId: 'new-random-id',
      prompt: 'same prompt',
      imageUrls: ['same-url'],
      nested: { requestId: 'new-nested-id', duration: '12' },
    },
    createdAfter: 1000,
  });

  assert.equal(matched?.id, 'job-video');
});

test('findReusableJobSubmission ignores finished or stale jobs', () => {
  const matched = findReusableJobSubmission({
    jobs: [
      {
        id: 'job-finished',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'succeeded',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 5000,
      },
      {
        id: 'job-stale',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'queued',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 1000,
      },
    ],
    userId: 'user-a',
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
    createdAfter: 3000,
  });

  assert.equal(matched, null);
});

test('reconcileRestartedMysqlJobs recovers stale running jobs after a server restart without marking them failed', () => {
  const reconciled = reconcileRestartedMysqlJobs([
    {
      id: 'job-running',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'running',
      retryCount: 0,
      maxRetries: 2,
      errorCode: '',
      errorMessage: '',
      createdAt: 1000,
      updatedAt: 2000,
      startedAt: 1500,
      finishedAt: null,
    },
    {
      id: 'job-queued',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'queued',
      retryCount: 0,
      maxRetries: 2,
      errorCode: '',
      errorMessage: '',
      createdAt: 1100,
      updatedAt: 2100,
      startedAt: null,
      finishedAt: null,
    },
  ]);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 'job-running');
  assert.equal(reconciled[0].status, 'retry_waiting');
  assert.equal(reconciled[0].startedAt, null);
  assert.equal(reconciled[0].finishedAt, null);
  assert.equal(reconciled[0].errorCode, 'service_restarted');
  assert.match(reconciled[0].errorMessage, /服务重启后任务已回收到待重试状态/);
});

test('reconcileStaleProviderlessRunningMysqlJobs only recovers old running jobs before upstream submission', () => {
  const reconciled = reconcileStaleProviderlessRunningMysqlJobs([
    {
      id: 'job-providerless-stale',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      retryCount: 0,
      maxRetries: 2,
      errorCode: '',
      errorMessage: '',
      createdAt: 1000,
      updatedAt: 1500,
      startedAt: 1500,
      finishedAt: null,
    },
    {
      id: 'job-provider-submitted',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'kie-task-id',
      createdAt: 1000,
      updatedAt: 1500,
      startedAt: 1500,
      finishedAt: null,
    },
    {
      id: 'job-young',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      createdAt: 9000,
      updatedAt: 9000,
      startedAt: 9000,
      finishedAt: null,
    },
  ], 10_000, 5_000);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 'job-providerless-stale');
  assert.equal(reconciled[0].status, 'retry_waiting');
  assert.equal(reconciled[0].startedAt, null);
  assert.equal(reconciled[0].finishedAt, null);
  assert.equal(reconciled[0].errorCode, 'provider_submit_stale');
  assert.match(reconciled[0].errorMessage, /未返回上游任务 ID/);
});
