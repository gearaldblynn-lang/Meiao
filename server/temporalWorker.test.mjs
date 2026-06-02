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

const createMysqlHarness = (initialJob) => {
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
      if (/SELECT COUNT\(\*\) AS running_count/.test(sql)) {
        return [[{ running_count: 0 }]];
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
