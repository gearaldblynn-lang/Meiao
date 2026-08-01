import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildJobSubmissionLockKey,
  createJobWorker,
  createSerializedJobSubmission,
  getSubtitleRemovalSubmissionGuardState,
  deleteJobById,
  findJobByClientSubmissionKey,
  findJobByProviderTaskIdForUser,
  findReusableJobRecord,
  findReusableJobSubmission,
  getJobQueueStats,
  getJobByIdForUpdate,
  isRunningJobConcurrencyBlocking,
  reconcileRestartedMysqlJobs,
  reconcileStaleCancelledRunningMysqlJobs,
  reconcileStaleProviderlessRunningMysqlJobs,
  reconcileStaleSubmittedRunningMysqlJobs,
  resolveJobDeletionAction,
  requestCancelJob,
  requestRetryJob,
  requestTombstonedJobRecovery,
  resolveSubmissionUnknownJob,
  selectJobsWithinConcurrencyLimits,
  shouldMysqlWorkerProcessTaskEngine,
  withMysqlSubmissionLock,
} from './jobManager.mjs';
import {
  deriveVoiceoverRetryPlan,
  isParentOwnedChildJob,
} from './voiceoverChildJobStore.mjs';
import { shouldReleaseJobCreditReservation } from './accountCredits.mjs';

const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const createJob = (id, userId, priority = 0, status = 'queued') => ({
  id,
  userId,
  status,
  priority,
  createdAt: Number(id.replace(/\D/g, '')) || 0,
});

test('classic mysql worker does not query or claim jobs while deployment drain is active', async () => {
  let poolCalls = 0;
  const worker = createJobWorker({
    getPool: async () => {
      poolCalls += 1;
      throw new Error('paused worker must not open the job pool');
    },
    executeJob: async () => {},
    getMaxConcurrency: () => 1,
    createLog: async () => {},
    findUserById: async () => null,
    isExecutionPaused: () => true,
  });

  worker.start(5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  worker.stop();

  assert.equal(poolCalls, 0);
});

test('classic mysql worker settles provider-completed rejected output and persists quarantine evidence', async () => {
  const row = {
    id: 'job-output-rejected-classic',
    user_id: 'user-1',
    module: 'translation',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'queued',
    priority: 0,
    payload_json: JSON.stringify({ resolutionMode: 'original' }),
    provider_task_id: null,
    result_json: null,
    error_code: null,
    error_message: null,
    error_detail: null,
    retry_count: 0,
    max_retries: 2,
    created_at: 1000,
    updated_at: 1000,
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
  };
  const toCamel = (column) => ({
    provider_task_id: 'providerTaskId',
    result_json: 'result',
    error_code: 'errorCode',
    error_message: 'errorMessage',
    error_detail: 'errorDetail',
    retry_count: 'retryCount',
    updated_at: 'updatedAt',
    started_at: 'startedAt',
    finished_at: 'finishedAt',
  })[column];
  const setColumn = (column, value) => {
    row[column] = value;
    const camel = toCamel(column);
    if (camel) row[camel] = value;
  };
  const pool = {
    async getConnection() {
      return { query: this.query.bind(this), release() {} };
    },
    async query(sql, params = []) {
      if (/SELECT GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/SELECT RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      if (/SELECT \*\s+FROM internal_jobs\s+WHERE status = 'running'/.test(sql)) return [[]];
      if (/SELECT \* FROM internal_jobs\s+WHERE status IN \('queued', 'retry_waiting'\)/.test(sql)) {
        return [row.status === 'queued' ? [row] : []];
      }
      if (/UPDATE internal_jobs\s+SET status = 'running'/.test(sql)) {
        if (row.status !== 'queued') return [{ affectedRows: 0 }];
        setColumn('status', 'running');
        setColumn('started_at', params[0]);
        setColumn('updated_at', params[1]);
        return [{ affectedRows: 1 }];
      }
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1/.test(sql)) return [[row]];
      if (/SELECT MAX\(attempt_no\) AS attempt_no/.test(sql)) return [[{ attempt_no: 0 }]];
      if (/INSERT INTO internal_job_(?:attempts|events)/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE internal_job_attempts/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE internal_jobs SET /.test(sql)) {
        const assignments = sql.match(/UPDATE internal_jobs SET ([\s\S]+) WHERE id = \?/)?.[1]
          .split(',')
          .map((item) => item.trim().replace(/\s*= \?$/, '')) || [];
        assignments.forEach((column, index) => setColumn(column, params[index]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL in classic worker test: ${sql}`);
    },
  };
  const settled = [];
  const released = [];
  const rejectedOutput = {
    providerTaskId: 'provider-task-classic',
    result: {
      quarantinedImageAssetId: 'asset-classic-1',
      imageOutputContract: { status: 'rejected', reason: 'aspect_ratio_mismatch' },
    },
  };
  const worker = createJobWorker({
    getPool: async () => pool,
    executeJob: async () => {
      throw Object.assign(new Error('output rejected'), {
        code: 'image_output_aspect_ratio_mismatch',
        providerStage: 'output_transform',
        providerTaskId: 'provider-task-classic',
        providerCompleted: true,
        rejectedOutput,
      });
    },
    getMaxConcurrency: () => 1,
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', jobConcurrency: 1 }),
    settleJobCredits: async (context) => settled.push(context),
    releaseJobCredits: async (context) => released.push(context),
    getTaskEngineMode: () => 'mysql',
    isExecutionPaused: () => false,
  });

  worker.start(5);
  await new Promise((resolve) => setTimeout(resolve, 80));
  worker.stop();

  assert.equal(row.status, 'failed');
  assert.equal(row.provider_task_id, 'provider-task-classic');
  assert.equal(row.error_code, 'image_output_aspect_ratio_mismatch');
  assert.deepEqual(JSON.parse(row.result_json), rejectedOutput.result);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].rejected, true);
  assert.equal(settled[0].output, rejectedOutput);
  assert.equal(released.length, 0);
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
        async beginTransaction() {
          events.push(`transaction-begin:${connectionId}`);
        },
        async commit() {
          events.push(`transaction-commit:${connectionId}`);
        },
        async rollback() {
          events.push(`transaction-rollback:${connectionId}`);
        },
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

test('findReusableJobSubmission prefers a top-level client submission key over volatile payload fields', () => {
  const jobs = [
    {
      id: 'job-stable-key',
      userId: 'user-a',
      module: 'video',
      taskType: 'kie_seedance_video',
      provider: 'kie',
      status: 'running',
      payload: {
        clientSubmissionKey: 'storyboard-shot-7',
        shellProjectId: 'generated-project-a',
        requestId: 'request-a',
        prompt: 'first payload snapshot',
      },
      createdAt: 5000,
    },
  ];
  const baseSubmission = {
    jobs,
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    createdAfter: 1000,
  };

  const sameKey = findReusableJobSubmission({
    ...baseSubmission,
    payload: {
      clientSubmissionKey: 'storyboard-shot-7',
      shellProjectId: 'generated-project-b',
      requestId: 'request-b',
      prompt: 'later payload snapshot',
    },
  });
  const differentKey = findReusableJobSubmission({
    ...baseSubmission,
    payload: {
      ...jobs[0].payload,
      clientSubmissionKey: 'storyboard-shot-8',
    },
  });

  assert.equal(sameKey?.id, 'job-stable-key');
  assert.equal(differentKey, null);
});

test('findReusableJobRecord searches every active row for an explicit client submission key', async () => {
  const queries = [];
  const oldActiveRow = {
    id: 'job-stable-key-old',
    user_id: 'user-a',
    module: 'video',
    task_type: 'kie_seedance_video',
    provider: 'kie',
    status: 'running',
    payload_json: JSON.stringify({ clientSubmissionKey: 'stable-video-key' }),
    created_at: 1,
    updated_at: 1,
  };
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [[oldActiveRow]];
    },
  };

  const matched = await findReusableJobRecord(pool, { id: 'user-a' }, {
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { clientSubmissionKey: 'stable-video-key', prompt: 'same semantic input' },
  }, 60 * 60 * 1000);

  assert.equal(matched?.id, oldActiveRow.id);
  assert.match(queries[0].sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.clientSubmissionKey'\)\) = \?/);
  assert.doesNotMatch(queries[0].sql, /created_at >=/);
  assert.doesNotMatch(queries[0].sql, /LIMIT 20/);
  assert.equal(queries[0].values.at(-1), 'stable-video-key');
});

test('explicit subtitle submission key discovers a terminal job after the create response was lost', () => {
  const matched = findReusableJobSubmission({
    jobs: [{
      id: 'subtitle-completed',
      userId: 'user-a',
      module: 'video',
      taskType: 'subtitle_remove_video',
      provider: 'golden_subtitle',
      status: 'succeeded',
      createdAt: 100,
      payload: { clientSubmissionKey: 'subtitle-key' },
    }],
    userId: 'user-a',
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: { clientSubmissionKey: 'subtitle-key' },
    createdAfter: 0,
  });

  assert.equal(matched?.id, 'subtitle-completed');
});

test('generation recovery finds the newest active or terminal job by client submission key', async () => {
  const terminalRow = {
    id: 'generation-completed',
    user_id: 'admin-1',
    module: 'virtual_model_library',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'succeeded',
    priority: 0,
    payload_json: JSON.stringify({
      clientSubmissionKey: 'virtual-model-generation:batch-1:C01:1',
    }),
    provider_task_id: 'provider-1',
    result_json: JSON.stringify({ imageUrl: 'https://example.com/result.png' }),
    error_code: null,
    error_message: null,
    error_detail: null,
    retry_count: 0,
    max_retries: 0,
    created_at: 100,
    updated_at: 200,
    started_at: 110,
    finished_at: 200,
    cancel_requested_at: null,
  };
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return [[terminalRow]];
    },
  };

  const matched = await findJobByClientSubmissionKey(
    pool,
    'admin-1',
    'virtual-model-generation:batch-1:C01:1',
    {
      module: 'virtual_model_library',
      taskType: 'kie_image',
      provider: 'kie',
    },
  );

  assert.equal(matched?.id, 'generation-completed');
  assert.equal(matched?.status, 'succeeded');
  assert.equal(matched?.maxRetries, 0);
  assert.match(calls[0].sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.clientSubmissionKey'\)\) = \?/);
  assert.match(calls[0].sql, /module = \?/);
  assert.match(calls[0].sql, /task_type = \?/);
  assert.match(calls[0].sql, /provider = \?/);
  assert.doesNotMatch(calls[0].sql, /status IN/);
  assert.deepEqual(calls[0].values, [
    'admin-1',
    'virtual_model_library',
    'kie_image',
    'kie',
    'virtual-model-generation:batch-1:C01:1',
  ]);
});

test('explicit subtitle submission key also discovers a cancelled terminal job', () => {
  const matched = findReusableJobSubmission({
    jobs: [{
      id: 'subtitle-cancelled',
      userId: 'user-a',
      module: 'video',
      taskType: 'subtitle_remove_video',
      provider: 'golden_subtitle',
      status: 'cancelled',
      createdAt: 100,
      payload: { clientSubmissionKey: 'subtitle-key' },
    }],
    userId: 'user-a',
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: { clientSubmissionKey: 'subtitle-key' },
    createdAfter: 0,
  });

  assert.equal(matched?.id, 'subtitle-cancelled');
});

test('mysql subtitle lookup includes terminal rows for an explicit idempotency key', async () => {
  const queries = [];
  const terminalRow = {
    id: 'subtitle-completed',
    user_id: 'user-a',
    module: 'video',
    task_type: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    status: 'succeeded',
    payload_json: JSON.stringify({ clientSubmissionKey: 'subtitle-key' }),
    created_at: 1,
    updated_at: 2,
  };
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [[terminalRow]];
    },
  };

  const matched = await findReusableJobRecord(pool, { id: 'user-a' }, {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: { clientSubmissionKey: 'subtitle-key' },
  });

  assert.equal(matched?.id, 'subtitle-completed');
  assert.match(queries[0].sql, /'failed', 'succeeded', 'cancelled'/);
});

test('mysql subtitle guard uses unpaged active count and targeted identity queries', async () => {
  const queries = [];
  const connection = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/COUNT\(\*\)/.test(sql)) return [[{ active_count: 3 }]];
      return [[]];
    },
  };

  const state = await getSubtitleRemovalSubmissionGuardState(connection, 'user-a', {
    batchId: 'batch-a',
    clientSubmissionKey: 'subtitle-key',
  });

  assert.equal(state.activeCount, 3);
  assert.equal(queries.length, 3);
  assert.ok(queries.every(({ sql }) => !/LIMIT 200/.test(sql)));
  assert.match(queries[0].sql, /status IN \('queued', 'running', 'retry_waiting'\)/);
  assert.match(queries[1].sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.batchId'\)\) = \?/);
  assert.match(queries[2].sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.clientSubmissionKey'\)\) = \?/);
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
  assert.notEqual(first, buildJobSubmissionLockKey({
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { prompt: 'different prompt', nested: { duration: 12 } },
  }));
});

test('submission lock key prefers clientSubmissionKey and keeps different keys independent', () => {
  const submission = {
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
  };
  const first = buildJobSubmissionLockKey({
    ...submission,
    payload: {
      clientSubmissionKey: 'storyboard-shot-7',
      shellProjectId: 'generated-project-a',
      prompt: 'first payload snapshot',
    },
  });
  const sameKey = buildJobSubmissionLockKey({
    ...submission,
    payload: {
      clientSubmissionKey: 'storyboard-shot-7',
      shellProjectId: 'generated-project-b',
      prompt: 'later payload snapshot',
    },
  });
  const differentKey = buildJobSubmissionLockKey({
    ...submission,
    payload: {
      clientSubmissionKey: 'storyboard-shot-8',
      shellProjectId: 'generated-project-a',
      prompt: 'first payload snapshot',
    },
  });

  assert.equal(first, sameKey);
  assert.notEqual(first, differentKey);
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

test('submission transaction rolls back the reservation when job creation fails', async () => {
  const pool = createNamedLockPool();
  const reservation = { id: 'reservation-1', userId: 'user-a', amount: 5 };

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
    }),
    /insert failed/
  );

  assert.equal(pool.events.filter((event) => event.startsWith('transaction-rollback:')).length, 1);
  assert.equal(pool.events.filter((event) => event.startsWith('transaction-commit:')).length, 0);
});

test('submission reserves credits and creates the job in one transaction before commit', async () => {
  const pool = createNamedLockPool();
  const operationEvents = [];

  const result = await createSerializedJobSubmission({
    pool,
    user: { id: 'user-a' },
    jobPayload: {
      module: 'video',
      taskType: 'kie_seedance_video',
      provider: 'kie',
      payload: { prompt: 'atomic submission' },
    },
    findReusableJob: async () => null,
    reserveCredits: async () => {
      operationEvents.push('reserve');
      return { id: 'reservation-atomic', userId: 'user-a', amount: 5 };
    },
    createJob: async () => {
      operationEvents.push('create');
      return { id: 'job-atomic', status: 'queued' };
    },
  });

  assert.equal(result.job.id, 'job-atomic');
  assert.deepEqual(operationEvents, ['reserve', 'create']);
  const transactionEvents = pool.events.filter((event) => event.startsWith('transaction-'));
  assert.equal(transactionEvents.length, 2);
  assert.match(transactionEvents[0], /^transaction-begin:/);
  assert.match(transactionEvents[1], /^transaction-commit:/);
});

test('cancel locks and rereads the job before deciding whether queued credits can be released', async () => {
  const queries = [];
  const events = [];
  const freshRunningJob = {
    id: 'job-raced',
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    status: 'running',
    providerTaskId: 'paid-task-id',
    payload: {},
  };
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{
          id: freshRunningJob.id,
          user_id: freshRunningJob.userId,
          module: freshRunningJob.module,
          task_type: freshRunningJob.taskType,
          provider: freshRunningJob.provider,
          status: freshRunningJob.status,
          provider_task_id: freshRunningJob.providerTaskId,
          payload_json: '{}',
        }]];
      }
      if (/UPDATE internal_jobs\s+SET/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { events.push('release'); },
  };
  const pool = { async getConnection() { return connection; } };
  let released = 0;

  const outcome = await requestCancelJob(pool, { ...freshRunningJob, status: 'queued', providerTaskId: '' }, {
    releaseQueuedCredits: async () => { released += 1; },
  });

  assert.equal(outcome.job.status, 'running');
  assert.equal(outcome.releasedQueuedCredits, false);
  assert.equal(released, 0);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
  assert.match(queries[0].sql, /FOR UPDATE/);
});

test('job deletion cancels queued work and only preserves financially unsettled submission-unknown records', () => {
  assert.equal(resolveJobDeletionAction({ status: 'queued' }), 'cancel_then_delete');
  assert.equal(resolveJobDeletionAction({ status: 'retry_waiting' }), 'cancel_then_delete');
  assert.equal(resolveJobDeletionAction({ status: 'running' }), 'block_active');
  assert.equal(resolveJobDeletionAction({
    status: 'running',
    providerTaskId: 'submitted-task-id',
    payload: { __tombstoneRecovery: { providerTaskId: 'submitted-task-id' } },
  }), 'block_submitted_recovery');
  assert.equal(resolveJobDeletionAction({
    status: 'failed',
    errorCode: 'provider_submission_unknown',
  }), 'delete');
  assert.equal(resolveJobDeletionAction({
    status: 'failed',
    errorCode: 'provider_submission_unknown',
  }, { pendingReservation: true }), 'block_submission_unknown');
  assert.equal(resolveJobDeletionAction({ status: 'succeeded' }), 'delete');
  assert.equal(resolveJobDeletionAction({ status: 'failed', errorCode: 'provider_timeout' }), 'delete');
  assert.equal(resolveJobDeletionAction({ status: 'cancelled' }), 'delete');
  assert.equal(resolveJobDeletionAction({
    status: 'cancelled',
    providerTaskId: 'submitted-task-id',
  }), 'block_submitted_cancelled');
  assert.equal(resolveJobDeletionAction({
    status: 'failed',
    errorCode: 'provider_timeout',
  }, { pendingReservation: true }), 'block_pending_reservation');
});

test('tombstoned submitted cancellation is requeued with its original provider id only', async () => {
  const events = [];
  const queries = [];
  const row = {
    id: '444444444444444444444444',
    user_id: 'user-a',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'cancelled',
    provider_task_id: 'existing-provider-task-id',
    payload_json: JSON.stringify({ prompt: 'preserved' }),
    result_json: null,
    error_code: 'request_cancelled',
    error_message: '用户取消了任务',
    retry_count: 0,
    max_retries: 2,
  };
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { events.push('release'); },
  };

  const recovered = await requestTombstonedJobRecovery(
    { async getConnection() { return connection; } },
    { id: row.id, userId: row.user_id },
  );

  assert.equal(recovered.status, 'retry_waiting');
  assert.equal(recovered.providerTaskId, 'existing-provider-task-id');
  assert.equal(recovered.payload.prompt, 'preserved');
  assert.equal(recovered.payload.__tombstoneRecovery.providerTaskId, 'existing-provider-task-id');
  assert.match(queries[1].sql, /status = 'retry_waiting'/);
  assert.match(queries[1].sql, /WHERE id = \? AND status = 'cancelled' AND provider_task_id = \?/);
  assert.equal(queries[1].values.at(-1), 'existing-provider-task-id');
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('non-queryable submitted cancellation enters manual resolution without erasing result evidence', async () => {
  const queries = [];
  const resultEvidence = { providerResponse: 'preserve-before-manual-review' };
  const row = {
    id: '555555555555555555555555',
    user_id: 'user-a',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'maxforai',
    status: 'cancelled',
    provider_task_id: 'sync-response-id',
    payload_json: JSON.stringify({ model: 'maxforai-image-2-relay' }),
    result_json: JSON.stringify(resultEvidence),
    error_code: 'request_cancelled',
  };
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  const outcome = await requestTombstonedJobRecovery(
    { async getConnection() { return connection; } },
    { id: row.id, userId: row.user_id },
  );

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'provider_recovery_manual');
  assert.deepEqual(outcome.result, resultEvidence);
  assert.doesNotMatch(queries[1].sql, /retry_waiting/);
  assert.doesNotMatch(queries[1].sql, /result_json/);
});

test('mysql deletion row-locks and refuses work that a concurrent retry already queued', async () => {
  const queries = [];
  const events = [];
  const freshQueuedRow = {
    id: 'job-delete-retry-race',
    user_id: 'user-a',
    module: 'video',
    task_type: 'kie_seedance_video',
    provider: 'kie',
    status: 'queued',
    provider_task_id: null,
    payload_json: '{}',
    retry_count: 0,
    max_retries: 0,
  };
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1 FOR UPDATE/.test(sql)) {
        return [[freshQueuedRow]];
      }
      if (/DELETE FROM internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected connection SQL: ${sql}`);
    },
    release() { events.push('release'); },
  };
  const pool = {
    async getConnection() { return connection; },
    async query(sql, values = []) {
      queries.push({ sql, values, pool: true });
      if (/SELECT \* FROM internal_jobs/.test(sql)) return [[freshQueuedRow]];
      if (/DELETE FROM internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
  };

  const outcome = await deleteJobById(pool, freshQueuedRow.id, {
    userId: 'user-a',
    hasPendingReservation: async () => false,
  });

  assert.equal(outcome.deleted, false);
  assert.equal(outcome.action, 'cancel_then_delete');
  assert.equal(queries.some(({ sql }) => /DELETE FROM internal_jobs/.test(sql)), false);
  assert.match(queries[0].sql, /FOR UPDATE/);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('mysql deletion preserves terminal jobs with an unprocessed reservation', async () => {
  const queries = [];
  const row = {
    id: 'job-pending-reservation',
    user_id: 'user-a',
    module: 'video',
    task_type: 'kie_seedance_video',
    provider: 'kie',
    status: 'failed',
    provider_task_id: null,
    payload_json: JSON.stringify({ __creditReservation: { id: 'reservation-pending' } }),
    error_code: 'provider_timeout',
  };
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql) {
      queries.push(sql);
      if (/FOR UPDATE/.test(sql)) return [[row]];
      if (/DELETE FROM internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  const outcome = await deleteJobById({ async getConnection() { return connection; } }, row.id, {
    userId: 'user-a',
    hasPendingReservation: async () => true,
  });

  assert.equal(outcome.deleted, false);
  assert.equal(outcome.action, 'block_pending_reservation');
  assert.equal(queries.some((sql) => /DELETE FROM internal_jobs/.test(sql)), false);
});

test('mysql deletion runs durable reference cleanup inside the job transaction', async () => {
  const events = [];
  const row = {
    id: 'job-delete-with-assets',
    user_id: 'user-a',
    module: 'buyer_show',
    task_type: 'buyer_show',
    provider: 'kie',
    status: 'succeeded',
    provider_task_id: 'provider-1',
    payload_json: JSON.stringify({ imageUrl: '/api/assets/file/asset-1/source.png' }),
    result_json: '{}',
  };
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async query(sql) {
      if (/FOR UPDATE/.test(sql)) return [[row]];
      if (/DELETE FROM internal_jobs/.test(sql)) {
        events.push('delete-job');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { events.push('release'); },
  };

  const outcome = await deleteJobById({ async getConnection() { return connection; } }, row.id, {
    userId: 'user-a',
    afterDelete: async (runner, job) => {
      assert.equal(runner, connection);
      assert.equal(job.id, row.id);
      events.push('queue-assets');
    },
  });

  assert.equal(outcome.deleted, true);
  assert.deepEqual(events, ['begin', 'delete-job', 'queue-assets', 'commit', 'release']);
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

test('manual retry rereads the job under a row lock inside its transaction', async () => {
  const queries = [];
  const connection = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [[{
        id: 'job-locked',
        user_id: 'user-a',
        task_type: 'kie_video',
        provider: 'kie',
        status: 'failed',
        payload_json: '{}',
      }]];
    },
  };

  const job = await getJobByIdForUpdate(connection, 'job-locked');
  assert.equal(job.id, 'job-locked');
  assert.match(queries[0].sql, /FOR UPDATE/);
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

test('reconcileRestartedMysqlJobs safely requeues providerless internal work', () => {
  const [reconciled] = reconcileRestartedMysqlJobs([{
    id: 'internal-restarted',
    userId: 'user-a',
    module: 'system',
    taskType: 'future_internal_maintenance',
    provider: 'internal',
    status: 'running',
    providerTaskId: '',
    createdAt: 1000,
    updatedAt: 2000,
    startedAt: 1500,
  }], 3000);

  assert.equal(reconciled.status, 'retry_waiting');
  assert.equal(reconciled.errorCode, 'service_restarted');
  assert.equal(reconciled.finishedAt, null);
});

test('classic MySQL restart then cancel keeps a speech-analysis submission reservation pending', async () => {
  const [restarted] = reconcileRestartedMysqlJobs([{
    id: 'voiceover-analysis-restarted-mysql',
    userId: 'user-a',
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    status: 'running',
    providerTaskId: '',
    result: {
      voiceoverCheckpoint: {
        version: 1,
        stage: 'speech_analysis_submitting',
        baseVideoAssetId: 'asset-base',
        originalAudioAssetId: 'asset-original',
        vocalAssetId: 'asset-vocal',
        backgroundAssetId: 'asset-background',
        analysisAttempt: 0,
      },
    },
    createdAt: 500,
    updatedAt: 1000,
    startedAt: 1000,
  }], 2000);
  const row = {
    id: restarted.id,
    user_id: restarted.userId,
    module: restarted.module,
    task_type: restarted.taskType,
    provider: restarted.provider,
    status: restarted.status,
    provider_task_id: null,
    payload_json: '{}',
    result_json: JSON.stringify(restarted.result),
    error_code: restarted.errorCode,
    error_message: restarted.errorMessage,
    retry_count: 0,
    max_retries: 0,
    created_at: restarted.createdAt,
    updated_at: restarted.updatedAt,
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
  };
  let releaseDecision = null;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql) {
      if (sql.startsWith('SELECT * FROM internal_jobs')) return [[row]];
      if (sql.includes('UPDATE internal_jobs')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  await requestCancelJob({
    async getConnection() {
      return connection;
    },
  }, restarted, {
    releaseQueuedCredits: async (_connection, freshJob) => {
      releaseDecision = shouldReleaseJobCreditReservation({
        job: freshJob,
        error: { code: 'request_cancelled' },
      });
    },
  });

  assert.equal(restarted.errorCode, 'service_restarted');
  assert.equal(releaseDecision, false);
});

test('reconcileRestartedMysqlJobs never resubmits a non-queryable kie chat response id', () => {
  const [reconciled] = reconcileRestartedMysqlJobs([{
    id: 'storyboard-chat-restarted',
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'running',
    providerTaskId: 'chat-response-id',
    createdAt: 1000,
    updatedAt: 2000,
    startedAt: 1500,
  }], 3000);

  assert.equal(reconciled.status, 'failed');
  assert.equal(reconciled.errorCode, 'provider_submission_unknown');
  assert.equal(reconciled.providerTaskId, 'chat-response-id');
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
  assert.equal(reconciled[0].errorCode, 'provider_submission_unknown');
  assert.match(reconciled[0].errorMessage, /防止重复扣费/);
});

test('reconcileStaleProviderlessRunningMysqlJobs safely requeues stale internal work', () => {
  const [reconciled] = reconcileStaleProviderlessRunningMysqlJobs([{
    id: 'internal-stale',
    provider: 'internal',
    taskType: 'future_internal_maintenance',
    status: 'running',
    providerTaskId: '',
    startedAt: 1000,
  }], 10_000, 5_000);

  assert.equal(reconciled.status, 'retry_waiting');
  assert.equal(reconciled.errorCode, 'service_restarted');
  assert.equal(reconciled.finishedAt, null);
});

test('admin can bind a verified provider task id to submission-unknown work without releasing credits', async () => {
  const events = [];
  const row = {
    id: 'job-unknown',
    user_id: 'user-a',
    module: 'video',
    task_type: 'kie_seedance_video',
    provider: 'kie',
    status: 'failed',
    provider_task_id: null,
    payload_json: JSON.stringify({ __creditReservation: { id: 'reservation-1', userId: 'user-a', amount: 5 } }),
    error_code: 'provider_submission_unknown',
    error_message: 'unknown',
    retry_count: 2,
  };
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async query(sql, values = []) {
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs\s+SET/.test(sql)) {
        events.push({ sql, values });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { events.push('release'); },
  };
  let released = 0;
  const result = await resolveSubmissionUnknownJob({
    pool: { async getConnection() { return connection; } },
    jobId: row.id,
    action: 'bind',
    providerTaskId: 'verified-provider-task',
    releaseReservation: async () => { released += 1; },
  });

  assert.equal(result.job.status, 'retry_waiting');
  assert.equal(result.job.providerTaskId, 'verified-provider-task');
  assert.equal(result.job.retryCount, 0);
  assert.equal(result.action, 'bind');
  assert.equal(released, 0);
  const update = events.find((event) => typeof event === 'object');
  assert.match(update.sql, /retry_count = 0/);
  assert.deepEqual(events.filter((event) => typeof event === 'string'), ['begin', 'commit', 'release']);
});

test('admin cannot bind a task id to a provider type without an idempotent query path', async () => {
  const row = {
    id: 'storyboard-chat-unknown',
    user_id: 'user-a',
    module: 'video',
    task_type: 'kie_chat',
    provider: 'kie',
    status: 'failed',
    provider_task_id: null,
    payload_json: JSON.stringify({ subFeature: 'storyboard' }),
    error_code: 'provider_submission_unknown',
  };
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql) {
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  await assert.rejects(
    () => resolveSubmissionUnknownJob({
      pool: { async getConnection() { return connection; } },
      jobId: row.id,
      action: 'bind',
      providerTaskId: 'chat-response-id',
    }),
    (error) => error?.code === 'submission_resolution_bind_unsupported'
  );
});

test('admin can explicitly release a submission-unknown reservation in the same transaction', async () => {
  const events = [];
  const row = {
    id: 'job-unknown-release',
    user_id: 'user-a',
    module: 'video',
    task_type: 'kie_seedance_video',
    provider: 'kie',
    status: 'failed',
    provider_task_id: null,
    payload_json: JSON.stringify({ __creditReservation: { id: 'reservation-2', userId: 'user-a', amount: 5 } }),
    error_code: 'provider_submission_unknown',
    error_message: 'unknown',
  };
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async query(sql) {
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs\s+SET/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { events.push('release'); },
  };
  const released = [];
  const result = await resolveSubmissionUnknownJob({
    pool: { async getConnection() { return connection; } },
    jobId: row.id,
    action: 'release',
    releaseReservation: async (receivedConnection, job) => {
      assert.equal(receivedConnection, connection);
      released.push(job.id);
    },
  });

  assert.equal(result.job.errorCode, 'provider_submission_released');
  assert.equal(result.action, 'release');
  assert.deepEqual(released, [row.id]);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('admin can release an exhausted tombstone recovery reservation but cannot bind it again', async () => {
  const row = {
    id: 'job-recovery-manual',
    user_id: 'user-a',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'failed',
    provider_task_id: 'provider-image-id',
    payload_json: JSON.stringify({
      __creditReservation: { id: 'reservation-recovery', userId: 'user-a', amount: 1 },
      __tombstoneRecovery: { providerTaskId: 'provider-image-id' },
    }),
    error_code: 'provider_recovery_manual',
    error_message: 'query retries exhausted',
  };
  const makeConnection = () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql) {
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  });

  await assert.rejects(
    () => resolveSubmissionUnknownJob({
      pool: { async getConnection() { return makeConnection(); } },
      jobId: row.id,
      action: 'bind',
      providerTaskId: 'another-id',
    }),
    (error) => error?.code === 'submission_resolution_bind_unsupported',
  );

  let released = 0;
  const result = await resolveSubmissionUnknownJob({
    pool: { async getConnection() { return makeConnection(); } },
    jobId: row.id,
    action: 'release',
    releaseReservation: async () => { released += 1; },
  });
  assert.equal(released, 1);
  assert.equal(result.job.errorCode, 'provider_recovery_released');
});

test('admin can settle a verified successful manual recovery with actual credits and evidence', async () => {
  const row = {
    id: 'job-recovery-settle',
    user_id: 'user-a',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'failed',
    provider_task_id: 'provider-image-success',
    payload_json: JSON.stringify({
      __creditReservation: { id: 'reservation-settle', userId: 'user-a', amount: 3 },
      __tombstoneRecovery: { providerTaskId: 'provider-image-success' },
    }),
    error_code: 'provider_recovery_manual',
    error_message: 'query retries exhausted',
  };
  const queries = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT \* FROM internal_jobs WHERE id = \? FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  let settlementInput = null;

  const result = await resolveSubmissionUnknownJob({
    pool: { async getConnection() { return connection; } },
    jobId: row.id,
    action: 'settle',
    actualCreditsConsumed: 2.5,
    verificationNote: 'KIE 后台订单核验成功',
    settleReservation: async (receivedConnection, job, input) => {
      assert.equal(receivedConnection, connection);
      assert.equal(job.id, row.id);
      settlementInput = input;
      return { settledAmount: input.actualCreditsConsumed };
    },
  });

  assert.deepEqual(settlementInput, {
    actualCreditsConsumed: 2.5,
    verificationNote: 'KIE 后台订单核验成功',
  });
  assert.equal(result.action, 'settle');
  assert.equal(result.job.errorCode, 'provider_recovery_settled');
  assert.equal(result.settlement.settledAmount, 2.5);
  assert.match(queries.at(-1).sql, /error_code = \?/);
});

test('manual settlement requires a nonnegative amount and verification evidence', async () => {
  const common = {
    pool: { async getConnection() { throw new Error('validation must run before database access'); } },
    jobId: 'job-1',
    action: 'settle',
  };
  await assert.rejects(
    () => resolveSubmissionUnknownJob({ ...common, actualCreditsConsumed: -1, verificationNote: 'verified' }),
    (error) => error?.code === 'submission_resolution_credits_invalid',
  );
  await assert.rejects(
    () => resolveSubmissionUnknownJob({ ...common, actualCreditsConsumed: 1, verificationNote: '' }),
    (error) => error?.code === 'submission_resolution_evidence_required',
  );
  for (const invalidNote of [123, true, {}, ['provider', 'verified']]) {
    await assert.rejects(
      () => resolveSubmissionUnknownJob({
        ...common,
        actualCreditsConsumed: 1,
        verificationNote: invalidNote,
      }),
      (error) => error?.code === 'submission_resolution_evidence_required',
    );
  }
  for (const invalidAmount of ['', null, Number.MAX_VALUE, 1.001]) {
    await assert.rejects(
      () => resolveSubmissionUnknownJob({
        ...common,
        actualCreditsConsumed: invalidAmount,
        verificationNote: 'verified',
      }),
      (error) => error?.code === 'submission_resolution_credits_invalid',
    );
  }
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

test('subtitle removal recovery requeues only jobs with a checkpointed provider task id', () => {
  const referenceTime = 20_000;
  const [submitted] = reconcileStaleSubmittedRunningMysqlJobs([{
    id: 'subtitle-submitted',
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    status: 'running',
    providerTaskId: 'golden-1',
    createdAt: 1_000,
    updatedAt: 1_000,
    startedAt: 1_000,
  }], referenceTime, 5_000);
  const [providerless] = reconcileRestartedMysqlJobs([{
    id: 'subtitle-providerless',
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    status: 'running',
    providerTaskId: '',
    createdAt: 1_000,
    updatedAt: 1_000,
    startedAt: 1_000,
  }], referenceTime);

  assert.equal(submitted.status, 'retry_waiting');
  assert.equal(submitted.providerTaskId, 'golden-1');
  assert.equal(providerless.status, 'failed');
  assert.equal(providerless.errorCode, 'provider_submission_unknown');
});

test('reconcileStaleSubmittedRunningMysqlJobs fails non-queryable chat ids without retrying', () => {
  const [reconciled] = reconcileStaleSubmittedRunningMysqlJobs([{
    id: 'stale-storyboard-chat',
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'running',
    providerTaskId: 'chat-response-id',
    createdAt: 1000,
    updatedAt: 1000,
    startedAt: 1000,
  }], 10_000, 5_000);

  assert.equal(reconciled.status, 'failed');
  assert.equal(reconciled.errorCode, 'provider_submission_unknown');
  assert.equal(reconciled.finishedAt, 10_000);
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
    /const providerTaskId = String\(error\?\.providerTaskId \|\| notifiedProviderTaskId \|\| latestJob\?\.providerTaskId \|\| ''\);[\s\S]*getNextJobFailureState\(\{[\s\S]*providerTaskId,/
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

test('mysql provider recovery lookup is scoped to the authenticated user', async () => {
  let observedSql = '';
  let observedValues = [];
  const pool = {
    query: async (sql, values) => {
      observedSql = sql;
      observedValues = values;
      return [[{
        id: 'source-job-1',
        user_id: 'user-1',
        module: 'one_click',
        task_type: 'kie_image',
        provider: 'kie',
        status: 'succeeded',
        provider_task_id: 'provider-task-1',
        payload_json: '{}',
        result_json: '{}',
        created_at: 1,
        updated_at: 1,
      }]];
    },
  };

  const source = await findJobByProviderTaskIdForUser(pool, 'user-1', 'provider-task-1');

  assert.match(observedSql, /WHERE user_id = \?[\s\S]*provider_task_id = \?[\s\S]*provider = 'kie'[\s\S]*task_type IN/);
  assert.deepEqual(observedValues.slice(0, 2), ['user-1', 'provider-task-1']);
  assert.ok(observedValues.includes('kie_image'));
  assert.equal(observedValues.includes('kie_recover'), false);
  assert.equal(source?.id, 'source-job-1');
  assert.equal(source?.userId, 'user-1');
});

const parentOwnedMysqlJob = (overrides = {}) => ({
  id: 'child-mysql-1',
  userId: 'user-1',
  module: 'video',
  taskType: 'kie_tts',
  provider: 'kie',
  status: 'running',
  payload: {
    executionOwner: 'parent',
    parentJobId: 'parent-mysql-1',
    childKey: 'tts:0:attempt:0',
    clientSubmissionKey: 'voiceover-child:parent-mysql-1:tts:0:attempt:0',
  },
  providerTaskId: '',
  result: null,
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1,
  updatedAt: 1,
  startedAt: 1,
  finishedAt: null,
  cancelRequestedAt: null,
  ...overrides,
});

test('pure mysql restart and stale reconcilers ignore parent-owned child jobs', () => {
  const providerless = parentOwnedMysqlJob();
  const submitted = parentOwnedMysqlJob({
    providerTaskId: 'provider-1',
    updatedAt: 1,
  });
  const cancelled = parentOwnedMysqlJob({
    providerTaskId: 'provider-1',
    cancelRequestedAt: 1,
    errorCode: 'request_cancelled',
  });
  assert.equal(isParentOwnedChildJob(providerless), true);
  assert.deepEqual(reconcileRestartedMysqlJobs([providerless], 10_000), []);
  assert.deepEqual(reconcileStaleProviderlessRunningMysqlJobs([providerless], 10_000, 1), []);
  assert.deepEqual(reconcileStaleSubmittedRunningMysqlJobs([submitted], 10_000, 1), []);
  assert.deepEqual(reconcileStaleCancelledRunningMysqlJobs([cancelled], 10_000, 1), []);
});

test('mysql generic cancel, retry, and delete cannot mutate a parent-owned child', async () => {
  const toRow = (job) => ({
    id: job.id,
    user_id: job.userId,
    module: job.module,
    task_type: job.taskType,
    provider: job.provider,
    status: job.status,
    payload_json: JSON.stringify(job.payload),
    provider_task_id: job.providerTaskId || null,
    result_json: job.result ? JSON.stringify(job.result) : null,
    retry_count: job.retryCount,
    max_retries: job.maxRetries,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    cancel_requested_at: job.cancelRequestedAt,
  });

  for (const operation of ['cancel', 'delete']) {
    const child = parentOwnedMysqlJob({
      status: operation === 'cancel' ? 'queued' : 'succeeded',
      startedAt: null,
      finishedAt: operation === 'delete' ? 2 : null,
    });
    let mutations = 0;
    const connection = {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async query(sql) {
        if (/SELECT \* FROM internal_jobs WHERE id = \?/.test(sql)) return [[toRow(child)]];
        if (/^(?:UPDATE|DELETE) internal_jobs/.test(sql.trim())) {
          mutations += 1;
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unhandled SQL: ${sql}`);
      },
    };
    const pool = { async getConnection() { return connection; } };
    await assert.rejects(
      operation === 'cancel'
        ? requestCancelJob(pool, child, {})
        : deleteJobById(pool, child.id, { userId: child.userId }),
      (error) => error.code === 'job_parent_owned_child_immutable',
      operation,
    );
    assert.equal(mutations, 0, operation);
  }

  const failedChild = parentOwnedMysqlJob({
    status: 'failed',
    startedAt: null,
    finishedAt: 2,
  });
  let retryMutations = 0;
  await assert.rejects(
    requestRetryJob({
      async query() {
        retryMutations += 1;
        return [{ affectedRows: 1 }];
      },
    }, failedChild, {}),
    (error) => error.code === 'job_parent_owned_child_immutable',
  );
  assert.equal(retryMutations, 0);
});

test('mysql queue stats query excludes parent-owned children at the database boundary', async () => {
  let observedSql = '';
  const counts = await getJobQueueStats({
    async query(sql) {
      observedSql = sql;
      return [[{ status: 'queued', count: 2 }]];
    },
  });
  assert.deepEqual(counts, { queued: 2, running: 0 });
  assert.match(observedSql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.executionOwner'\)\)/);
  assert.match(observedSql, /<> 'parent'/);
});

test('all mysql generic selectors, claims, and stale recovery queries include the parent ownership SQL predicate', () => {
  const compactSource = jobManagerSource.replace(/\s+/g, ' ');
  const requiredFragments = [
    "WHERE status = 'running' AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}",
    "WHERE status IN ('queued', 'retry_waiting') AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}",
    "WHERE id = ? AND status IN ('queued', 'retry_waiting') AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}",
    "WHERE status = 'running' AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION} AND (provider_task_id IS NULL OR provider_task_id = '')",
    "WHERE status = 'running' AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION} AND provider_task_id IS NOT NULL",
    "WHERE status = 'running' AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION} AND cancel_requested_at IS NOT NULL",
    "WHERE user_id = ? AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION} ORDER BY created_at DESC LIMIT ?",
    "WHERE user_id = ? AND task_type = 'subtitle_remove_video' AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}",
  ];
  for (const fragment of requiredFragments) {
    assert.ok(compactSource.includes(fragment), `expected protected SQL fragment ${fragment}`);
  }
});

test('mysql voiceover retry preserves checkpoint and guards the failed-to-queued transition', async () => {
  const queries = [];
  const checkpoint = {
    version: 1,
    stage: 'speech_analysis_submitting',
    baseVideoAssetId: 'asset-base',
    originalAudioAssetId: 'asset-audio',
    vocalAssetId: 'asset-vocal',
    backgroundAssetId: 'asset-background',
    analysisAttempt: 0,
  };
  const job = {
    id: 'parent-mysql-1',
    userId: 'user-1',
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    status: 'failed',
    payload: { removeText: false },
    result: { audit: 'keep', voiceoverCheckpoint: checkpoint },
    errorCode: 'voiceover_analysis_submission_unknown',
  };
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };

  await requestRetryJob(pool, job, {
    voiceoverRetryPlan: { kind: 'analysis', userConfirmed: true },
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WHERE id = \? AND status = \?/);
  assert.equal(queries[0].values.at(-1), 'failed');
  const serializedResult = queries[0].values.find((value) => (
    typeof value === 'string' && value.includes('"voiceoverCheckpoint"')
  ));
  const nextResult = JSON.parse(serializedResult);
  assert.equal(nextResult.audit, 'keep');
  assert.equal(nextResult.voiceoverCheckpoint.stage, 'voice_separated');
  assert.equal(nextResult.voiceoverCheckpoint.analysisAttempt, 1);
});

test('mysql confirmed voiceover provider retry clears the previous attempt provider task id', async () => {
  const job = {
    id: 'parent-mysql-provider-retry',
    userId: 'user-1',
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    status: 'failed',
    providerTaskId: 'provider-golden-attempt-0',
    payload: {
      taskPurpose: 'voiceover_translation',
      subFeature: 'voiceover_translation',
      removeText: true,
    },
    result: {
      voiceoverCheckpoint: {
        version: 1,
        stage: 'subtitle_removal',
        baseVideoAssetId: 'asset-base',
        subtitleRemoval: {
          childJobId: 'golden-child-attempt-0',
          attempt: 0,
          status: 'failed',
        },
        analysisAttempt: 0,
      },
    },
    errorCode: 'provider_job_failed',
  };
  const voiceoverRetryPlan = deriveVoiceoverRetryPlan(job, {
    confirmNewProviderAttempt: true,
  });
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };

  await requestRetryJob(pool, job, { voiceoverRetryPlan });

  assert.equal(queries.length, 1);
  const assignments = queries[0].sql
    .split('SET ')[1]
    .split(' WHERE')[0]
    .split(',')
    .map((value) => value.trim());
  const providerTaskIdIndex = assignments.findIndex((value) => value.startsWith('provider_task_id ='));
  assert.notEqual(providerTaskIdIndex, -1);
  assert.equal(queries[0].values[providerTaskIdIndex], null);
});

test('mysql voiceover retry rejects active parents and accepts cancelled query-only recovery with an exact CAS', async () => {
  const checkpoint = {
    version: 1,
    stage: 'subtitle_removal',
    baseVideoAssetId: 'asset-base',
    subtitleRemoval: {
      childJobId: 'golden-child-0',
      providerTaskId: 'golden-provider-0',
      attempt: 0,
      status: 'submitted',
    },
    analysisAttempt: 0,
  };
  let mutations = 0;
  const pool = {
    async query(sql, values) {
      mutations += 1;
      assert.match(sql, /WHERE id = \? AND status = \?/);
      assert.equal(values.at(-1), 'cancelled');
      return [{ affectedRows: 1 }];
    },
  };
  const parent = {
    id: 'parent-mysql-cancelled',
    userId: 'user-1',
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    status: 'running',
    payload: { removeText: true },
    result: { voiceoverCheckpoint: checkpoint },
    errorCode: 'request_cancelled',
  };
  await assert.rejects(
    requestRetryJob(pool, parent, {
      voiceoverRetryPlan: { kind: 'reuse' },
    }),
    (error) => error?.code === 'job_state_changed',
  );
  assert.equal(mutations, 0);

  await requestRetryJob(pool, {
    ...parent,
    status: 'cancelled',
  }, {
    voiceoverRetryPlan: { kind: 'reuse' },
  });
  assert.equal(mutations, 1);
});

test('classic mysql abort finalization receives the latest submitted child checkpoint', async () => {
  const row = {
    id: 'parent-classic-checkpoint',
    user_id: 'user-1',
    module: 'video',
    task_type: 'voiceover_translate_video',
    provider: 'internal',
    status: 'queued',
    priority: 0,
    payload_json: JSON.stringify({ taskPurpose: 'voiceover_translation', removeText: true }),
    provider_task_id: null,
    result_json: JSON.stringify({
      audit: 'keep',
      voiceoverCheckpoint: {
        version: 1,
        stage: 'input_prepared',
        baseVideoAssetId: 'asset-base',
        analysisAttempt: 0,
      },
    }),
    error_code: null,
    error_message: null,
    error_detail: null,
    retry_count: 0,
    max_retries: 0,
    created_at: 1_000,
    updated_at: 1_000,
    started_at: null,
    finished_at: null,
    cancel_requested_at: 900,
  };
  const calls = [];
  const toCamel = (column) => ({
    user_id: 'userId',
    task_type: 'taskType',
    payload_json: 'payload',
    provider_task_id: 'providerTaskId',
    result_json: 'result',
    error_code: 'errorCode',
    error_message: 'errorMessage',
    error_detail: 'errorDetail',
    retry_count: 'retryCount',
    max_retries: 'maxRetries',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
    started_at: 'startedAt',
    finished_at: 'finishedAt',
    cancel_requested_at: 'cancelRequestedAt',
  })[column];
  const setColumn = (column, value) => {
    row[column] = value;
    if (toCamel(column)) row[toCamel(column)] = value;
  };
  const pool = {
    async getConnection() {
      return {
        query: this.query.bind(this),
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/SELECT RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      if (/SELECT \*\s+FROM internal_jobs\s+WHERE status = 'running'/.test(sql)) return [[]];
      if (/SELECT \* FROM internal_jobs\s+WHERE status IN \('queued', 'retry_waiting'\)/.test(sql)) {
        return [row.status === 'queued' ? [row] : []];
      }
      if (/UPDATE internal_jobs\s+SET status = 'running'/.test(sql)) {
        setColumn('status', 'running');
        setColumn('started_at', params[0]);
        setColumn('updated_at', params[1]);
        return [{ affectedRows: 1 }];
      }
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1/.test(sql)) return [[row]];
      if (/SELECT \* FROM internal_jobs[\s\S]+user_id = \?[\s\S]+FOR UPDATE/.test(sql)) return [[row]];
      if (/UPDATE internal_jobs[\s\S]+SET result_json = \?[\s\S]+status = 'running' AND started_at = \?/.test(sql)) {
        setColumn('result_json', params[0]);
        setColumn('updated_at', params[1]);
        return [{ affectedRows: 1 }];
      }
      if (/SELECT MAX\(attempt_no\) AS attempt_no/.test(sql)) return [[{ attempt_no: 0 }]];
      if (/INSERT INTO internal_job_(?:attempts|events)/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE internal_job_attempts/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE internal_jobs SET /.test(sql)) {
        const assignments = sql.match(/UPDATE internal_jobs SET ([\s\S]+) WHERE id = \?/)?.[1]
          .split(',')
          .map((item) => item.trim().replace(/\s*= \?$/, '')) || [];
        assignments.forEach((column, index) => setColumn(column, params[index]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
  const sideEffects = [];
  const creditJobs = [];
  const worker = createJobWorker({
    getPool: async () => pool,
    executeJob: async (_job, _signal, { onResultCheckpoint }) => {
      await onResultCheckpoint({
        voiceoverCheckpoint: {
          stage: 'subtitle_removal',
          subtitleRemoval: {
            childJobId: 'golden-child-0',
            providerTaskId: 'golden-provider-0',
            attempt: 0,
            status: 'submitted',
          },
        },
      });
      assert.equal(JSON.parse(row.result_json).voiceoverCheckpoint.stage, 'subtitle_removal');
      sideEffects.push('paid-call');
      return { result: { ignoredOnCancel: true } };
    },
    getMaxConcurrency: () => 1,
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', jobConcurrency: 1 }),
    settleJobCredits: ({ job: creditJob }) => creditJobs.push(creditJob),
    getTaskEngineMode: () => 'mysql',
    isExecutionPaused: () => false,
  });
  worker.start(5);
  await new Promise((resolve) => setTimeout(resolve, 80));
  worker.stop();

  assert.deepEqual(sideEffects, ['paid-call']);
  assert.equal(row.status, 'cancelled');
  assert.equal(JSON.parse(row.result_json).audit, 'keep');
  assert.equal(JSON.parse(row.result_json).voiceoverCheckpoint.stage, 'subtitle_removal');
  assert.equal(
    creditJobs[0]?.result?.voiceoverCheckpoint?.subtitleRemoval?.providerTaskId,
    'golden-provider-0',
  );
  assert.equal(shouldReleaseJobCreditReservation({
    job: creditJobs[0],
    error: { code: 'request_cancelled' },
    aborted: true,
  }), false);
});

test('classic mysql worker cannot complete or fail after its terminal claim guard loses a race', async () => {
  for (const outcome of ['complete', 'fail']) {
    const row = {
      id: `parent-classic-stale-${outcome}`,
      user_id: 'user-1',
      module: 'video',
      task_type: 'voiceover_translate_video',
      provider: 'internal',
      status: 'queued',
      priority: 0,
      payload_json: JSON.stringify({ taskPurpose: 'voiceover_translation', removeText: false }),
      provider_task_id: null,
      result_json: JSON.stringify({
        voiceoverCheckpoint: {
          version: 1,
          stage: 'input_prepared',
          baseVideoAssetId: 'asset-base',
          analysisAttempt: 0,
        },
      }),
      error_code: null,
      error_message: null,
      error_detail: null,
      retry_count: 0,
      max_retries: 0,
      created_at: 1_000,
      updated_at: 1_000,
      started_at: null,
      finished_at: null,
      cancel_requested_at: null,
    };
    let driftBeforeTerminalUpdate = false;
    let claimDrifted = false;
    let attemptFinishes = 0;
    const terminalEvents = [];
    const creditFinalizations = [];
    const setColumn = (column, value) => {
      row[column] = value;
    };
    const query = async (sql, params = []) => {
      if (/SELECT GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/SELECT RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      if (/SELECT \*\s+FROM internal_jobs\s+WHERE status = 'running'/.test(sql)) {
        return [row.status === 'running' ? [row] : []];
      }
      if (/SELECT \* FROM internal_jobs\s+WHERE status IN \('queued', 'retry_waiting'\)/.test(sql)) {
        return [row.status === 'queued' ? [row] : []];
      }
      if (/UPDATE internal_jobs\s+SET status = 'running'/.test(sql)) {
        setColumn('status', 'running');
        setColumn('started_at', params[0]);
        setColumn('updated_at', params[1]);
        return [{ affectedRows: 1 }];
      }
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1/.test(sql)) return [[row]];
      if (/SELECT MAX\(attempt_no\) AS attempt_no/.test(sql)) return [[{ attempt_no: 0 }]];
      if (/INSERT INTO internal_job_attempts/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO internal_job_events/.test(sql)) {
        if (claimDrifted && ['job_completed', 'job_failed'].includes(params[5])) {
          terminalEvents.push(params[5]);
        }
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE internal_job_attempts/.test(sql)) {
        if (claimDrifted) attemptFinishes += 1;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE internal_jobs SET /.test(sql)) {
        const assignments = sql.match(/UPDATE internal_jobs SET ([\s\S]+) WHERE id = \?/)?.[1]
          .split(',')
          .map((item) => item.trim().replace(/\s*= \?$/, '')) || [];
        if (assignments.includes('status') && driftBeforeTerminalUpdate) {
          driftBeforeTerminalUpdate = false;
          claimDrifted = true;
          setColumn('status', 'running');
          setColumn('started_at', Number(row.started_at) + 1);
          setColumn('result_json', JSON.stringify({ newerClaim: outcome }));
          setColumn('error_code', null);
          setColumn('error_message', null);
          if (/user_id = \? AND status = 'running' AND started_at = \?/.test(sql)) {
            return [{ affectedRows: 0 }];
          }
        }
        assignments.forEach((column, index) => setColumn(column, params[index]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    };
    const pool = {
      query,
      async getConnection() {
        return {
          query,
          async beginTransaction() {},
          async commit() {},
          async rollback() {},
          release() {},
        };
      },
    };
    const worker = createJobWorker({
      getPool: async () => pool,
      executeJob: async () => {
        driftBeforeTerminalUpdate = true;
        if (outcome === 'fail') {
          throw Object.assign(new Error('stale executor failed'), { code: 'provider_network_error' });
        }
        return { result: { staleExecutor: true } };
      },
      getMaxConcurrency: () => 1,
      createLog: async () => {},
      findUserById: async () => ({ id: 'user-1', jobConcurrency: 1 }),
      settleJobCredits: () => creditFinalizations.push('settle'),
      releaseJobCredits: () => creditFinalizations.push('release'),
      getTaskEngineMode: () => 'mysql',
      isExecutionPaused: () => false,
    });
    worker.start(5);
    await new Promise((resolve) => setTimeout(resolve, 80));
    worker.stop();

    assert.equal(row.status, 'running', outcome);
    assert.deepEqual(JSON.parse(row.result_json), { newerClaim: outcome }, outcome);
    assert.equal(row.error_code, null, outcome);
    assert.deepEqual(creditFinalizations, [], outcome);
    assert.equal(attemptFinishes, 0, outcome);
    assert.deepEqual(terminalEvents, [], outcome);
  }
});
