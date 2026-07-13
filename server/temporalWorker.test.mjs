import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalJobRecord, getLocalJobById } from './localJobStore.mjs';
import { createLocalTemporalActivities, createMysqlTemporalActivities } from './temporalWorker.mjs';

const createStore = () => ({
  users: [{ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }],
  logs: [],
  jobs: [],
});

test('local temporal activity claims and completes a queued job', async () => {
  const store = createStore();
  const job = createLocalJobRecord(store, store.users[0], {
    module: 'system',
    taskType: 'local_probe',
    provider: 'internal',
    payload: {},
  });
  const writes = [];
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: (nextStore) => writes.push(JSON.parse(JSON.stringify(nextStore))),
    executeJob: async (claimedJob, _signal, options) => {
      await options.onProviderTaskId('provider-task-1');
      return { providerTaskId: 'provider-task-1', result: { ok: true } };
    },
    createLog: (entry) => store.logs.push(entry),
    findUserById: (userId) => store.users.find((user) => user.id === userId),
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: job.id });

  const completed = getLocalJobById(store, job.id);
  assert.equal(result.status, 'succeeded');
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.providerTaskId, 'provider-task-1');
  assert.deepEqual(completed.result, { ok: true });
  assert.ok(writes.length >= 2);
  assert.equal(store.logs.at(-1).action, 'job_completed');
});

test('local temporal activity writes a failed terminal job without submitting upstream id', async () => {
  const store = createStore();
  const job = createLocalJobRecord(store, store.users[0], {
    module: 'system',
    taskType: 'local_probe_failed',
    provider: 'internal',
    payload: {},
    maxRetries: 0,
  });
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    executeJob: async () => {
      throw Object.assign(new Error('bad task'), { code: 'provider_bad_request' });
    },
    createLog: (entry) => store.logs.push(entry),
    findUserById: (userId) => store.users.find((user) => user.id === userId),
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: job.id });

  const failed = getLocalJobById(store, job.id);
  assert.equal(result.status, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'provider_bad_request');
  assert.equal(failed.providerTaskId, '');
  assert.equal(store.logs.at(-1).status, 'failed');
});

test('local temporal activity returns a terminal result when the job was already removed', async () => {
  const store = createStore();
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    executeJob: async () => {
      throw new Error('executeJob should not be called for a missing job');
    },
    createLog: (entry) => store.logs.push(entry),
    findUserById: (userId) => store.users.find((user) => user.id === userId),
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: 'deleted-job' });

  assert.equal(result.jobId, 'deleted-job');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.errorCode, 'job_not_found');
  assert.equal(store.logs.length, 0);
});

const createMysqlHarness = (initialJob, options = {}) => {
  const state = {
    job: {
      ...initialJob,
      provider_task_id: initialJob.provider_task_id ?? null,
      result_json: initialJob.result_json ?? null,
      error_code: initialJob.error_code ?? null,
      error_message: initialJob.error_message ?? null,
      retry_count: initialJob.retry_count ?? 0,
      max_retries: initialJob.max_retries ?? 0,
      started_at: initialJob.started_at ?? null,
      finished_at: initialJob.finished_at ?? null,
      cancel_requested_at: initialJob.cancel_requested_at ?? null,
    },
    attempts: [],
    events: [],
    runningRows: options.runningRows || [],
  };
  const toCamel = (column) => ({
    user_id: 'userId',
    task_type: 'taskType',
    payload_json: 'payload',
    provider_task_id: 'providerTaskId',
    result_json: 'result',
    error_code: 'errorCode',
    error_message: 'errorMessage',
    retry_count: 'retryCount',
    max_retries: 'maxRetries',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
    started_at: 'startedAt',
    finished_at: 'finishedAt',
    cancel_requested_at: 'cancelRequestedAt',
  })[column] || column;
  const setColumn = (column, value) => {
    state.job[column] = value;
    state.job[toCamel(column)] = value;
  };
  const pool = {
    async query(sql, params = []) {
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1/.test(sql)) {
        return [[state.job]];
      }
      if (/SELECT \*\s+FROM internal_jobs\s+WHERE status = 'running' AND user_id = \? AND id <> \?/.test(sql)) {
        return [state.runningRows];
      }
      if (/UPDATE internal_jobs\s+SET status = 'running'/.test(sql)) {
        if (!['queued', 'retry_waiting', 'running'].includes(state.job.status)) {
          return [{ affectedRows: 0 }];
        }
        setColumn('status', 'running');
        setColumn('started_at', params[0]);
        setColumn('updated_at', params[1]);
        setColumn('error_code', null);
        setColumn('error_message', null);
        return [{ affectedRows: 1 }];
      }
      if (/SELECT MAX\(attempt_no\) AS attempt_no/.test(sql)) {
        return [[{ attempt_no: state.attempts.length }]];
      }
      if (/INSERT INTO internal_job_attempts/.test(sql)) {
        state.attempts.push(params);
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO internal_job_events/.test(sql)) {
        state.events.push(params);
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE internal_job_attempts/.test(sql)) {
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE internal_jobs SET /.test(sql)) {
        const assignments = sql.match(/UPDATE internal_jobs SET ([\s\S]+) WHERE id = \?/)?.[1]
          .split(',')
          .map((item) => item.trim().replace(/\s*= \?$/, '')) || [];
        assignments.forEach((column, index) => setColumn(column, params[index]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL in test harness: ${sql}`);
    },
  };
  return { state, pool };
};

test('mysql temporal activity returns a terminal result when the job was already removed', async () => {
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1/.test(sql)) {
        return [[]];
      }
      throw new Error(`execute SQL should not be called for a missing job: ${sql}`);
    },
  };
  const logs = [];
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async () => {
      throw new Error('executeJob should not be called for a missing job');
    },
    createLog: async (entry) => logs.push(entry),
    findUserById: async () => null,
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'deleted-job',
    workflowId: 'meiao-job-deleted-job',
    runId: 'run-1',
  });

  assert.equal(result.jobId, 'deleted-job');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.errorCode, 'job_not_found');
  assert.equal(logs.length, 0);
});

test('mysql temporal activity does not resubmit a running job before provider task id is known', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-running-no-provider',
    user_id: 'user-1',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'running',
    priority: 0,
    payload_json: JSON.stringify({ traceId: 'trace-running' }),
    provider_task_id: null,
    created_at: 1000,
    updated_at: 1500,
    started_at: 1500,
  });
  let executeCalls = 0;
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async () => {
      executeCalls += 1;
      throw new Error('running providerless job must not be resubmitted');
    },
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-running-no-provider',
    workflowId: 'meiao-job-running-no-provider',
    runId: 'run-1',
  });

  assert.equal(result.status, 'running');
  assert.equal(result.providerTaskId, '');
  assert.equal(executeCalls, 0);
  assert.equal(state.attempts.length, 0);
  assert.equal(state.events.length, 0);
  assert.equal(state.job.started_at, 1500);
});

test('mysql temporal activity executes a queued db job and writes attempts/events', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-1',
    user_id: 'user-1',
    module: 'system',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'queued',
    priority: 0,
    payload_json: JSON.stringify({ traceId: 'trace-1' }),
    created_at: 1000,
    updated_at: 1000,
  });
  const logs = [];
  const heartbeats = [];
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async (claimedJob, _signal, options) => {
      assert.equal(claimedJob.id, 'job-1');
      await options.onProviderTaskId('provider-task-1');
      return { providerTaskId: 'provider-task-1', result: { imageUrl: 'https://example.test/image.png' } };
    },
    createLog: async (entry) => logs.push(entry),
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }),
    heartbeat: (details) => heartbeats.push(details),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-1',
    workflowId: 'meiao-job-job-1',
    runId: 'run-1',
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(state.job.status, 'succeeded');
  assert.equal(state.job.provider_task_id, 'provider-task-1');
  assert.equal(JSON.parse(state.job.result_json).imageUrl, 'https://example.test/image.png');
  assert.ok(state.attempts.length >= 1);
  assert.ok(state.events.length >= 3);
  assert.ok(state.events.some((params) => (
    params[4] === 'provider_wait'
    && params[5] === 'provider_wait_started'
    && params[13] === 'provider-task-1'
  )));
  assert.equal(logs.at(-1).action, 'job_completed');
  assert.ok(heartbeats.some((details) => details?.jobId === 'job-1' && details?.stage === 'running'));
  assert.ok(heartbeats.some((details) => details?.jobId === 'job-1' && details?.stage === 'provider_wait'));
  assert.ok(heartbeats.some((details) => details?.providerTaskId === 'provider-task-1'));
});

test('mysql temporal activity ignores stale running jobs when checking user concurrency', async () => {
  const referenceTime = Date.now();
  const { state, pool } = createMysqlHarness({
    id: 'job-after-stale-running',
    user_id: 'user-1',
    module: 'buyer_show',
    task_type: 'kie_chat',
    provider: 'kie',
    status: 'queued',
    priority: 0,
    payload_json: JSON.stringify({ traceId: 'trace-after-stale' }),
    created_at: referenceTime,
    updated_at: referenceTime,
  }, {
    runningRows: [
      {
        id: 'old-submitted-running',
        user_id: 'user-1',
        module: 'one_click',
        task_type: 'kie_image',
        provider: 'kie',
        status: 'running',
        provider_task_id: 'kie-old-task',
        created_at: referenceTime - 8 * 60 * 60 * 1000,
        updated_at: referenceTime - 7 * 60 * 60 * 1000,
        started_at: referenceTime - 7 * 60 * 60 * 1000,
      },
    ],
  });
  let executeCalls = 0;
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    getMaxConcurrency: () => 1,
    getSubmittedRunningStaleMs: () => 6 * 60 * 60 * 1000,
    executeJob: async (_claimedJob, _signal, options) => {
      executeCalls += 1;
      await options.onProviderTaskId('provider-task-after-stale');
      return { providerTaskId: 'provider-task-after-stale', result: { ok: true } };
    },
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'staff', jobConcurrency: 1 }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-after-stale-running',
    workflowId: 'meiao-job-after-stale-running',
    runId: 'run-1',
  });

  assert.equal(executeCalls, 1);
  assert.equal(result.status, 'succeeded');
  assert.equal(state.job.status, 'succeeded');
});

test('mysql temporal activity releases concurrency while retrying transient asset upload failure', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-asset-upload-retry',
    user_id: 'user-1',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'retry_waiting',
    priority: 0,
    payload_json: JSON.stringify({ traceId: 'trace-upload' }),
    provider_task_id: null,
    retry_count: 0,
    max_retries: 2,
    created_at: 1000,
    updated_at: 1500,
  });
  const logs = [];
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async () => {
      const error = new Error('fetch failed');
      error.code = 'provider_network_error';
      error.providerStage = 'asset_upload';
      throw error;
    },
    createLog: async (entry) => logs.push(entry),
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-asset-upload-retry',
    workflowId: 'meiao-job-asset-upload-retry',
    runId: 'run-1',
  });

  assert.equal(result.status, 'retry_waiting');
  assert.equal(state.job.status, 'retry_waiting');
  assert.equal(state.job.retry_count, 1);
  assert.equal(state.job.provider_task_id, null);
  assert.equal(state.job.error_code, 'provider_network_error');
  assert.equal(state.job.finished_at, null);
  assert.ok(state.events.some((params) => (
    params[4] === 'asset_upload'
    && params[5] === 'job_failed'
    && params[6] === 'started'
    && params[10] === 'provider_network_error'
  )));
  assert.equal(logs.at(-1).action, 'job_retry_waiting');
  assert.equal(logs.at(-1).status, 'started');
});

test('mysql temporal activity recovers the old provider task under a separate retry budget', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-submitted-video-recovery',
    user_id: 'user-1',
    module: 'video',
    task_type: 'kie_seedance_video',
    provider: 'kie',
    status: 'retry_waiting',
    priority: 0,
    payload_json: JSON.stringify({ prompt: 'video prompt' }),
    provider_task_id: 'provider-task-1',
    retry_count: 0,
    max_retries: 0,
    created_at: 1000,
    updated_at: 1500,
  });
  const released = [];
  let executeCalls = 0;
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async (claimedJob) => {
      executeCalls += 1;
      assert.equal(claimedJob.providerTaskId, 'provider-task-1');
      const error = new Error('poll timeout');
      error.code = 'provider_timeout';
      error.providerStage = 'polling';
      error.providerTaskId = claimedJob.providerTaskId;
      throw error;
    },
    releaseJobCredits: async (context) => released.push(context),
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-submitted-video-recovery',
    workflowId: 'meiao-job-submitted-video-recovery',
    runId: 'run-1',
  });

  assert.equal(executeCalls, 1);
  assert.equal(result.status, 'retry_waiting');
  assert.equal(result.providerTaskId, 'provider-task-1');
  assert.equal(result.retryCount, 1);
  assert.equal(state.job.status, 'retry_waiting');
  assert.equal(state.job.provider_task_id, 'provider-task-1');
  assert.equal(state.job.finished_at, null);
  assert.equal(released.length, 1);
  assert.equal(released[0].retryWaiting, true);
});

test('mysql temporal provider checkpoint starts a fresh recovery retry budget', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-create-retries-exhausted',
    user_id: 'user-1',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'retry_waiting',
    priority: 0,
    payload_json: JSON.stringify({ prompt: 'image prompt' }),
    provider_task_id: null,
    retry_count: 2,
    max_retries: 2,
    created_at: 1000,
    updated_at: 1500,
  });
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async (_claimedJob, _signal, options) => {
      await options.onProviderTaskId('provider-task-new');
      const error = new Error('poll timeout');
      error.code = 'provider_timeout';
      error.providerStage = 'polling';
      error.providerTaskId = 'provider-task-new';
      throw error;
    },
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-create-retries-exhausted',
    workflowId: 'meiao-job-create-retries-exhausted',
    runId: 'run-1',
  });

  assert.equal(result.status, 'retry_waiting');
  assert.equal(result.providerTaskId, 'provider-task-new');
  assert.equal(result.retryCount, 1);
  assert.equal(state.job.retry_count, 1);
});
