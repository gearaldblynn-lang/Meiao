import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildJobSubmissionLockKey,
  createSerializedJobSubmission,
  findReusableJobSubmission,
  isRunningJobConcurrencyBlocking,
  reconcileRestartedMysqlJobs,
  reconcileStaleCancelledRunningMysqlJobs,
  reconcileStaleProviderlessRunningMysqlJobs,
  reconcileStaleSubmittedRunningMysqlJobs,
  requestRetryJob,
  selectJobsWithinConcurrencyLimits,
  shouldMysqlWorkerProcessTaskEngine,
  withMysqlSubmissionLock,
} from './jobManager.mjs';

const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const createJob = (id, userId, priority = 0, status = 'queued') => ({
  id,
  userId,
  status,
  priority,
  createdAt: Number(id.replace(/\D/g, '')) || 0,
});

const createNamedLockPool = () => {
  const held = new Set();
  const waiters = new Map();
  const events = [];
  let connectionSequence = 0;

  const acquire = async (name) => {
    if (!held.has(name)) {
      held.add(name);
      return;
    }
    await new Promise((resolve) => {
      const queue = waiters.get(name) || [];
      queue.push(resolve);
      waiters.set(name, queue);
    });
    held.add(name);
  };

  const release = (name) => {
    held.delete(name);
    const queue = waiters.get(name) || [];
    const next = queue.shift();
    if (queue.length > 0) waiters.set(name, queue);
    else waiters.delete(name);
    next?.();
  };

  return {
    events,
    async getConnection() {
      const connectionId = ++connectionSequence;
      return {
        async query(sql, values = []) {
          if (/GET_LOCK/.test(sql)) {
            events.push(`wait:${connectionId}`);
            await acquire(values[0]);
            events.push(`acquired:${connectionId}`);
            return [[{ acquired: 1 }]];
          }
          if (/RELEASE_LOCK/.test(sql)) {
            events.push(`released:${connectionId}`);
            release(values[0]);
            return [[{ released: 1 }]];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {
          events.push(`connection-released:${connectionId}`);
        },
      };
    },
  };
};

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

test('isRunningJobConcurrencyBlocking ignores stale running jobs that the reconciler will release', () => {
  const referenceTime = 10 * 60 * 60 * 1000;

  assert.equal(isRunningJobConcurrencyBlocking({
    status: 'running',
    taskType: 'kie_image',
    providerTaskId: '',
    startedAt: referenceTime - (20 * 60 * 1000),
  }, {
    referenceTime,
    providerlessStaleMs: 5 * 60 * 1000,
  }), false);

  assert.equal(isRunningJobConcurrencyBlocking({
    status: 'running',
    providerTaskId: 'kie-task-stale',
    updatedAt: referenceTime - (7 * 60 * 60 * 1000),
  }, {
    referenceTime,
    submittedStaleMs: 6 * 60 * 60 * 1000,
  }), false);

  assert.equal(isRunningJobConcurrencyBlocking({
    status: 'running',
    providerTaskId: 'kie-task-cancel',
    cancelRequestedAt: referenceTime - 2 * 60 * 1000,
  }, {
    referenceTime,
    cancelledStaleMs: 60 * 1000,
  }), false);

  assert.equal(isRunningJobConcurrencyBlocking({
    status: 'running',
    taskType: 'kie_image',
    providerTaskId: '',
    startedAt: referenceTime - 10 * 60 * 1000,
  }, {
    referenceTime,
    providerlessStaleMs: 5 * 60 * 1000,
  }), true);

  assert.equal(isRunningJobConcurrencyBlocking({
    status: 'running',
    providerTaskId: 'kie-task-fresh',
    updatedAt: referenceTime - 2 * 60 * 60 * 1000,
  }, {
    referenceTime,
    submittedStaleMs: 6 * 60 * 60 * 1000,
  }), true);
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

test('findReusableJobSubmission ignores internal credit reservation metadata when matching active jobs', () => {
  const matched = findReusableJobSubmission({
    jobs: [
      {
        id: 'job-credit-reserved',
        userId: 'user-a',
        module: 'one_click',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'queued',
        payload: {
          prompt: 'same prompt',
          imageUrls: ['same-url'],
          __creditReservation: {
            id: 'reservation-1',
            amount: 3,
            userId: 'user-a',
          },
        },
        createdAt: 2000,
      },
    ],
    userId: 'user-a',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    payload: {
      prompt: 'same prompt',
      imageUrls: ['same-url'],
    },
    createdAfter: 1000,
  });

  assert.equal(matched?.id, 'job-credit-reserved');
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

test('submission lock key ignores volatile request and credit metadata', () => {
  const first = buildJobSubmissionLockKey({
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: {
      requestId: 'request-1',
      prompt: 'same prompt',
      nested: { duration: 12, requestId: 'nested-1' },
      __creditReservation: { id: 'reservation-1', amount: 5 },
    },
  });
  const second = buildJobSubmissionLockKey({
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: {
      nested: { requestId: 'nested-2', duration: 12 },
      prompt: 'same prompt',
      requestId: 'request-2',
    },
  });

  assert.equal(first, second);
  assert.ok(first.length <= 64);
  assert.notEqual(first, buildJobSubmissionLockKey({
    userId: 'user-b',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { prompt: 'same prompt', nested: { duration: 12 } },
  }));
});

test('submission lock releases its MySQL connection on success and error', async () => {
  const pool = createNamedLockPool();
  const submission = {
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { prompt: 'test' },
  };

  assert.equal(await withMysqlSubmissionLock(pool, submission, async () => 'ok'), 'ok');
  await assert.rejects(
    () => withMysqlSubmissionLock(pool, submission, async () => {
      throw new Error('create failed');
    }),
    /create failed/
  );

  assert.equal(pool.events.filter((event) => event.startsWith('released:')).length, 2);
  assert.equal(pool.events.filter((event) => event.startsWith('connection-released:')).length, 2);
});

test('submission lock serializes find reserve and create for the same semantic job', async () => {
  const pool = createNamedLockPool();
  const user = { id: 'user-a' };
  const jobPayload = {
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { prompt: 'same prompt', requestId: 'request-1' },
  };
  let reusableJob = null;
  let reserveCalls = 0;
  let createCalls = 0;
  let unblockCreate;
  const createBlocked = new Promise((resolve) => { unblockCreate = resolve; });
  let firstCreateStarted;
  const firstCreateReady = new Promise((resolve) => { firstCreateStarted = resolve; });

  const operations = {
    findReusableJob: async () => reusableJob,
    reserveCredits: async () => {
      reserveCalls += 1;
      return { id: 'reservation-1', userId: user.id, amount: 5 };
    },
    createJob: async (_connection, receivedUser, receivedPayload, receivedReservation) => {
      assert.equal(receivedUser, user);
      assert.equal(receivedPayload, jobPayload);
      assert.equal(receivedReservation.id, 'reservation-1');
      createCalls += 1;
      firstCreateStarted();
      await createBlocked;
      reusableJob = { id: 'job-1', status: 'queued' };
      return reusableJob;
    },
    releaseCredits: async () => null,
  };

  const first = createSerializedJobSubmission({ pool, user, jobPayload, ...operations });
  await firstCreateReady;
  const second = createSerializedJobSubmission({
    pool,
    user,
    jobPayload: {
      ...jobPayload,
      payload: { prompt: 'same prompt', requestId: 'request-2' },
    },
    ...operations,
  });
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(createCalls, 1);
  } finally {
    unblockCreate();
  }

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.deduped, false);
  assert.equal(secondResult.deduped, true);
  assert.equal(firstResult.job.id, 'job-1');
  assert.equal(secondResult.job.id, 'job-1');
  assert.equal(reserveCalls, 1);
  assert.equal(createCalls, 1);
});

test('submission lock compensates a reservation when job creation fails', async () => {
  const pool = createNamedLockPool();
  const reservation = { id: 'reservation-1', userId: 'user-a', amount: 5 };
  const released = [];

  await assert.rejects(
    () => createSerializedJobSubmission({
      pool,
      user: { id: 'user-a' },
      jobPayload: {
        module: 'video',
        taskType: 'kie_seedance_video',
        provider: 'kie',
        payload: { prompt: 'test' },
      },
      findReusableJob: async () => null,
      reserveCredits: async () => reservation,
      createJob: async () => {
        throw new Error('insert failed');
      },
      releaseCredits: async (_connection, receivedReservation) => {
        released.push(receivedReservation);
      },
    }),
    /insert failed/
  );

  assert.deepEqual(released, [reservation]);
});

test('retry with a replacement reservation clears the old provider task id before resubmission', async () => {
  const queries = [];
  const connection = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };

  await requestRetryJob(connection, {
    id: 'job-1',
    module: 'video',
    provider: 'kie',
    providerTaskId: 'old-provider-task',
  }, { resetProviderTaskId: true });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /provider_task_id = \?/);
  assert.match(queries[0].sql, /retry_count = \?/);
  assert.equal(queries[0].values.at(-3), null);
  assert.equal(queries[0].values.at(-2), 0);
});

test('reconcileRestartedMysqlJobs fails providerless jobs and only recovers submitted tasks', () => {
  const reconciled = reconcileRestartedMysqlJobs([
    {
      id: 'job-providerless',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_video',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      retryCount: 0,
      maxRetries: 0,
      errorCode: '',
      errorMessage: '',
      createdAt: 1000,
      updatedAt: 2000,
      startedAt: 1500,
      finishedAt: null,
    },
    {
      id: 'job-submitted',
      userId: 'user-a',
      module: 'video',
      taskType: 'kie_video',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'provider-task-1',
      retryCount: 0,
      maxRetries: 0,
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

  assert.equal(reconciled.length, 2);
  const providerless = reconciled.find((job) => job.id === 'job-providerless');
  const submitted = reconciled.find((job) => job.id === 'job-submitted');
  assert.equal(providerless.status, 'failed');
  assert.equal(providerless.startedAt, null);
  assert.equal(typeof providerless.finishedAt, 'number');
  assert.equal(providerless.errorCode, 'provider_submission_unknown');
  assert.match(providerless.errorMessage, /防止重复扣费/);
  assert.equal(submitted.status, 'retry_waiting');
  assert.equal(submitted.startedAt, null);
  assert.equal(submitted.finishedAt, null);
  assert.equal(submitted.errorCode, 'service_restarted');
  assert.equal(submitted.providerTaskId, 'provider-task-1');
});

test('reconcileStaleProviderlessRunningMysqlJobs fails old running jobs before upstream submission', () => {
  const reconciled = reconcileStaleProviderlessRunningMysqlJobs([
    {
      id: 'job-providerless-stale',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'local_probe',
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
      taskType: 'local_probe',
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
      taskType: 'local_probe',
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
  assert.equal(reconciled[0].status, 'failed');
  assert.equal(reconciled[0].startedAt, null);
  assert.equal(reconciled[0].finishedAt, 10_000);
  assert.equal(reconciled[0].errorCode, 'provider_submit_stale');
  assert.match(reconciled[0].errorMessage, /未返回上游任务 ID/);
});

test('reconcileStaleProviderlessRunningMysqlJobs keeps kie chat submit alive longer than short cloud stale windows', () => {
  const tenMinutesAgo = 10 * 60 * 1000;
  const sixteenMinutesAgo = 16 * 60 * 1000;
  const referenceTime = 20 * 60 * 1000;
  const shortCloudStaleMs = 5 * 60 * 1000;

  const reconciled = reconcileStaleProviderlessRunningMysqlJobs([
    {
      id: 'job-kie-chat-short-cloud-window',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      retryCount: 0,
      maxRetries: 2,
      errorCode: '',
      errorMessage: '',
      createdAt: referenceTime - tenMinutesAgo,
      updatedAt: referenceTime - tenMinutesAgo,
      startedAt: referenceTime - tenMinutesAgo,
      finishedAt: null,
    },
    {
      id: 'job-kie-chat-truly-stale',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      retryCount: 0,
      maxRetries: 2,
      errorCode: '',
      errorMessage: '',
      createdAt: referenceTime - sixteenMinutesAgo,
      updatedAt: referenceTime - sixteenMinutesAgo,
      startedAt: referenceTime - sixteenMinutesAgo,
      finishedAt: null,
    },
  ], referenceTime, shortCloudStaleMs);

  assert.deepEqual(reconciled.map((job) => job.id), ['job-kie-chat-truly-stale']);
});

test('reconcileStaleProviderlessRunningMysqlJobs keeps kie image asset staging alive longer than short cloud stale windows', () => {
  const tenMinutesAgo = 10 * 60 * 1000;
  const sixteenMinutesAgo = 16 * 60 * 1000;
  const referenceTime = 20 * 60 * 1000;
  const shortCloudStaleMs = 5 * 60 * 1000;

  const reconciled = reconcileStaleProviderlessRunningMysqlJobs([
    {
      id: 'job-kie-image-staging-assets',
      taskType: 'kie_image',
      status: 'running',
      providerTaskId: '',
      startedAt: referenceTime - tenMinutesAgo,
    },
    {
      id: 'job-kie-image-truly-stale',
      taskType: 'kie_image',
      status: 'running',
      providerTaskId: '',
      startedAt: referenceTime - sixteenMinutesAgo,
    },
    {
      id: 'job-other-stale',
      taskType: 'other_task',
      status: 'running',
      providerTaskId: '',
      startedAt: referenceTime - tenMinutesAgo,
    },
  ], referenceTime, shortCloudStaleMs);

  assert.deepEqual(reconciled.map((job) => job.id), ['job-kie-image-truly-stale', 'job-other-stale']);
});

test('reconcileStaleSubmittedRunningMysqlJobs requeues old submitted running jobs for result recovery', () => {
  const referenceTime = 10 * 60 * 60 * 1000;
  const staleMs = 6 * 60 * 60 * 1000;

  const reconciled = reconcileStaleSubmittedRunningMysqlJobs([
    {
      id: 'job-submitted-stale',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'kie-task-id',
      createdAt: referenceTime - (8 * 60 * 60 * 1000),
      updatedAt: referenceTime - (7 * 60 * 60 * 1000),
      startedAt: referenceTime - (7 * 60 * 60 * 1000),
      finishedAt: null,
    },
    {
      id: 'job-submitted-young',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'kie-task-id-2',
      createdAt: referenceTime - (2 * 60 * 60 * 1000),
      updatedAt: referenceTime - (2 * 60 * 60 * 1000),
      startedAt: referenceTime - (2 * 60 * 60 * 1000),
      finishedAt: null,
    },
    {
      id: 'job-providerless-old',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      createdAt: referenceTime - (8 * 60 * 60 * 1000),
      updatedAt: referenceTime - (7 * 60 * 60 * 1000),
      startedAt: referenceTime - (7 * 60 * 60 * 1000),
      finishedAt: null,
    },
  ], referenceTime, staleMs);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 'job-submitted-stale');
  assert.equal(reconciled[0].status, 'retry_waiting');
  assert.equal(reconciled[0].providerTaskId, 'kie-task-id');
  assert.equal(reconciled[0].startedAt, null);
  assert.equal(reconciled[0].finishedAt, null);
  assert.equal(reconciled[0].updatedAt, referenceTime);
  assert.equal(reconciled[0].errorCode, 'provider_wait_stale');
  assert.match(reconciled[0].errorMessage, /已提交上游/);
});

test('reconcileStaleCancelledRunningMysqlJobs releases cancelled running jobs after abort acknowledgement stalls', () => {
  const reconciled = reconcileStaleCancelledRunningMysqlJobs([
    {
      id: 'job-cancelled-stale',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'provider-task-id',
      retryCount: 0,
      maxRetries: 2,
      errorCode: 'request_cancelled',
      errorMessage: '用户请求取消任务',
      createdAt: 1000,
      updatedAt: 2000,
      startedAt: 1500,
      finishedAt: null,
      cancelRequestedAt: 2000,
    },
    {
      id: 'job-cancelled-young',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'provider-task-id-2',
      errorCode: 'request_cancelled',
      errorMessage: '用户请求取消任务',
      createdAt: 1000,
      updatedAt: 9000,
      startedAt: 1500,
      finishedAt: null,
      cancelRequestedAt: 9000,
    },
  ], 10_000, 5_000);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 'job-cancelled-stale');
  assert.equal(reconciled[0].status, 'cancelled');
  assert.equal(reconciled[0].finishedAt, 10_000);
  assert.equal(reconciled[0].errorCode, 'request_cancelled');
  assert.match(reconciled[0].errorMessage, /已自动取消并释放并发/);
});

test('classic mysql worker includes provider task id in recovery failure-state calculation', () => {
  assert.match(
    jobManagerSource,
    /const providerTaskId = String\(error\?\.providerTaskId \|\| latestJob\?\.providerTaskId \|\| ''\);[\s\S]*getNextJobFailureState\(\{[\s\S]*providerTaskId,/
  );
  assert.match(
    jobManagerSource,
    /provider_task_id:\s*value,[\s\S]{0,100}retry_count:\s*0/
  );
});

test('temporal bootstrap marks restarted providerless running jobs submission-unknown', () => {
  assert.match(jobManagerSource, /export const reconcileRestartedProviderlessRunningJobs/);
  assert.match(
    serverSource,
    /taskEngine === 'temporal'[\s\S]{0,260}reconcileRestartedProviderlessRunningJobs\(pool\)/
  );
});

test('recovery job creation persists provider task id before execution', () => {
  assert.match(jobManagerSource, /providerTaskId:\s*String\(payload\.providerTaskId \|\| ''\)/);
  assert.match(jobManagerSource, /job\.providerTaskId \|\| null/);
  assert.ok((serverSource.match(/providerTaskId:\s*body\.providerTaskId/g) || []).length >= 2);
});
