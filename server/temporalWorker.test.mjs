import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLocalJobRecord, getLocalJobById } from './localJobStore.mjs';
import { createLocalTemporalActivities, createMysqlTemporalActivities } from './temporalWorker.mjs';
import { shouldReleaseJobCreditReservation } from './accountCredits.mjs';
import { VOICEOVER_ANALYSIS_EVIDENCE_VERSION } from './voiceoverContract.mjs';

const temporalWorkflowSource = readFileSync(new URL('./temporal/workflows.mjs', import.meta.url), 'utf8');

const createStore = () => ({
  users: [{ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }],
  logs: [],
  jobs: [],
});

test('temporal activity heartbeat interval is env-configurable with a conservative default', async () => {
  const temporalWorker = await import('./temporalWorker.mjs');
  assert.equal(typeof temporalWorker.getTemporalActivityHeartbeatIntervalMs, 'function');
  assert.equal(temporalWorker.getTemporalActivityHeartbeatIntervalMs({}), 10_000);
  assert.equal(temporalWorker.getTemporalActivityHeartbeatIntervalMs({
    MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS: '5000',
  }), 5_000);
  assert.equal(temporalWorker.getTemporalActivityHeartbeatIntervalMs({
    MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS: '100',
  }), 10_000);
});

test('local temporal activity leaves queued work unclaimed while deployment drain is active', async () => {
  const store = createStore();
  const job = createLocalJobRecord(store, store.users[0], {
    module: 'system',
    taskType: 'local_probe',
    provider: 'internal',
    payload: {},
  });
  let executeCalls = 0;
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    executeJob: async () => { executeCalls += 1; },
    createLog: () => {},
    findUserById: () => store.users[0],
    isExecutionPaused: () => true,
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: job.id });

  assert.equal(result.status, 'queued');
  assert.equal(getLocalJobById(store, job.id)?.status, 'queued');
  assert.equal(executeCalls, 0);
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

test('local temporal activity keeps heartbeating while a provider request is still running', async () => {
  const store = createStore();
  const job = createLocalJobRecord(store, store.users[0], {
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'maxforai',
    payload: {},
    maxRetries: 0,
  });
  const heartbeats = [];
  let releaseProvider;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    executeJob: async () => {
      await providerGate;
      return { result: { imageUrl: 'https://example.test/image.png' } };
    },
    createLog: (entry) => store.logs.push(entry),
    findUserById: (userId) => store.users.find((user) => user.id === userId),
    heartbeat: (details) => heartbeats.push(details),
    heartbeatIntervalMs: 5,
  });

  const activityResult = activities.executeLocalJobAttemptActivity({ jobId: job.id });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const runningHeartbeats = heartbeats.filter((details) => (
    details?.jobId === job.id && details?.stage === 'running'
  ));
  releaseProvider();
  const result = await activityResult;

  assert.ok(runningHeartbeats.length >= 2, 'long-running provider calls must emit periodic heartbeats');
  assert.equal(result.status, 'succeeded');
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

test('local temporal activity settles provider-completed rejected output and keeps quarantine evidence', async () => {
  const store = createStore();
  const job = createLocalJobRecord(store, store.users[0], {
    module: 'translation',
    taskType: 'maxforai_image',
    provider: 'maxforai',
    payload: {},
    maxRetries: 0,
  });
  const settled = [];
  const released = [];
  const rejectedOutput = {
    result: {
      quarantinedImageAssetId: 'asset-inline-1',
      imageOutputContract: { sourceWidth: 899, sourceHeight: 1750, targetWidth: 312, targetHeight: 840 },
    },
  };
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    executeJob: async () => {
      throw Object.assign(new Error('output rejected'), {
        code: 'image_output_aspect_ratio_mismatch',
        providerStage: 'output_transform',
        providerCompleted: true,
        rejectedOutput,
      });
    },
    settleJobCredits: (context) => settled.push(context),
    releaseJobCredits: (context) => released.push(context),
    createLog: (entry) => store.logs.push(entry),
    findUserById: (userId) => store.users.find((user) => user.id === userId),
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: job.id });
  const failed = getLocalJobById(store, job.id);

  assert.equal(result.status, 'failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'image_output_aspect_ratio_mismatch');
  assert.deepEqual(failed.result, rejectedOutput.result);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].rejected, true);
  assert.equal(settled[0].output, rejectedOutput);
  assert.equal(released.length, 0);
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
    attemptFinishes: 0,
    events: [],
    runningRows: options.runningRows || [],
    driftBeforeTerminalUpdate: false,
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
    async getConnection() {
      return { query: this.query.bind(this), release() {} };
    },
    async query(sql, params = []) {
      if (/SELECT GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/SELECT RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      if (/SELECT \* FROM internal_jobs WHERE id = \? LIMIT 1/.test(sql)) {
        return [[state.job]];
      }
      if (/SELECT \* FROM internal_jobs[\s\S]+WHERE id = \? AND user_id = \?[\s\S]+FOR UPDATE/.test(sql)) {
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
      if (/UPDATE internal_jobs[\s\S]+SET result_json = \?[\s\S]+status = 'running' AND started_at = \?/.test(sql)) {
        setColumn('result_json', params[0]);
        setColumn('updated_at', params[1]);
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
        state.attemptFinishes += 1;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE internal_jobs SET /.test(sql)) {
        const assignments = sql.match(/UPDATE internal_jobs SET ([\s\S]+) WHERE id = \?/)?.[1]
          .split(',')
          .map((item) => item.trim().replace(/\s*= \?$/, '')) || [];
        if (assignments.includes('status') && state.driftBeforeTerminalUpdate) {
          state.driftBeforeTerminalUpdate = false;
          setColumn('status', 'running');
          setColumn('started_at', Number(state.job.started_at) + 1);
          setColumn('result_json', JSON.stringify({ newerClaim: true }));
          setColumn('error_code', null);
          setColumn('error_message', null);
          if (/user_id = \? AND status = 'running' AND started_at = \?/.test(sql)) {
            return [{ affectedRows: 0 }];
          }
        }
        assignments.forEach((column, index) => setColumn(column, params[index]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL in test harness: ${sql}`);
    },
  };
  return {
    state,
    pool,
    driftBeforeTerminalUpdate() {
      state.driftBeforeTerminalUpdate = true;
    },
  };
};

test('mysql temporal activity leaves queued work unclaimed while deployment drain is active', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-paused',
    user_id: 'user-1',
    module: 'one_click',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'queued',
    priority: 0,
    payload_json: '{}',
    created_at: 1000,
    updated_at: 1000,
  });
  let executeCalls = 0;
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async () => { executeCalls += 1; },
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1' }),
    isExecutionPaused: () => true,
  });

  const result = await activities.executeMysqlJobAttemptActivity({ jobId: 'job-paused' });

  assert.equal(result.status, 'queued');
  assert.equal(state.job.status, 'queued');
  assert.equal(state.attempts.length, 0);
  assert.equal(executeCalls, 0);
});

test('mysql temporal activity settles provider-completed rejected output and persists quarantine evidence', async () => {
  const { state, pool } = createMysqlHarness({
    id: 'job-output-rejected',
    user_id: 'user-1',
    module: 'translation',
    task_type: 'kie_image',
    provider: 'kie',
    status: 'queued',
    priority: 0,
    payload_json: JSON.stringify({ resolutionMode: 'original' }),
    provider_task_id: null,
    retry_count: 0,
    max_retries: 2,
    created_at: 1000,
    updated_at: 1000,
  });
  const settled = [];
  const released = [];
  const rejectedOutput = {
    providerTaskId: 'provider-task-output-rejected',
    result: {
      quarantinedImageAssetId: 'asset-remote-1',
      imageOutputContract: { sourceWidth: 899, sourceHeight: 1750, targetWidth: 312, targetHeight: 840 },
    },
  };
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async (_job, _signal, options) => {
      await options.onProviderTaskId('provider-task-output-rejected');
      throw Object.assign(new Error('output rejected'), {
        code: 'image_output_aspect_ratio_mismatch',
        providerStage: 'output_transform',
        providerTaskId: 'provider-task-output-rejected',
        providerCompleted: true,
        rejectedOutput,
      });
    },
    settleJobCredits: async (context) => settled.push(context),
    releaseJobCredits: async (context) => released.push(context),
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', username: 'user-1', displayName: 'User 1', role: 'admin' }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: 'job-output-rejected',
    workflowId: 'meiao-job-output-rejected',
    runId: 'run-1',
  });

  assert.equal(result.status, 'failed');
  assert.equal(state.job.status, 'failed');
  assert.equal(state.job.provider_task_id, 'provider-task-output-rejected');
  assert.equal(state.job.error_code, 'image_output_aspect_ratio_mismatch');
  assert.deepEqual(JSON.parse(state.job.result_json), rejectedOutput.result);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].rejected, true);
  assert.equal(settled[0].output, rejectedOutput);
  assert.equal(released.length, 0);
});

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

const voiceoverParentJob = (status = 'queued') => ({
  id: 'voiceover-parent-temporal',
  userId: 'user-1',
  module: 'video',
  taskType: 'voiceover_translate_video',
  provider: 'internal',
  status,
  priority: 0,
  payload: { taskPurpose: 'voiceover_translation', removeText: false },
  providerTaskId: '',
  result: {
    audit: 'keep',
    voiceoverCheckpoint: {
      version: 1,
      stage: 'input_prepared',
      baseVideoAssetId: 'asset-base',
      analysisAttempt: 0,
    },
  },
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  startedAt: status === 'running' ? 1_000 : null,
  finishedAt: null,
  cancelRequestedAt: null,
});

const parentOwnedTemporalChild = () => ({
  id: 'voiceover-child-temporal',
  userId: 'user-1',
  module: 'video',
  taskType: 'kie_tts',
  provider: 'kie',
  status: 'queued',
  priority: 0,
  payload: {
    executionOwner: 'parent',
    parentJobId: 'voiceover-parent-temporal',
    childKey: 'tts:0:attempt:0',
    clientSubmissionKey: 'voiceover-child:voiceover-parent-temporal:tts:0:attempt:0',
  },
  providerTaskId: '',
  result: null,
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  startedAt: null,
  finishedAt: null,
  cancelRequestedAt: null,
});

test('local temporal activity awaits and preserves a parent result checkpoint before continuing', async () => {
  const store = createStore();
  store.jobs = [voiceoverParentJob()];
  const sideEffects = [];
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    mutateStore: async (operation) => operation(store),
    executeJob: async (_job, _signal, { onResultCheckpoint }) => {
      await onResultCheckpoint({
        voiceoverCheckpoint: {
          stage: 'audio_extracted',
          originalAudioAssetId: 'asset-audio',
          analysisEvidenceVersion: VOICEOVER_ANALYSIS_EVIDENCE_VERSION,
        },
      });
      assert.equal(store.jobs[0].result.voiceoverCheckpoint.stage, 'audio_extracted');
      sideEffects.push('paid-call');
      throw Object.assign(new Error('lost'), { code: 'provider_network_error' });
    },
    createLog: async () => {},
    findUserById: () => store.users[0],
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: 'voiceover-parent-temporal' });
  assert.equal(result.status, 'failed');
  assert.deepEqual(sideEffects, ['paid-call']);
  assert.equal(store.jobs[0].result.audit, 'keep');
  assert.equal(store.jobs[0].result.voiceoverCheckpoint.stage, 'audio_extracted');
});

test('Temporal restart then cancel keeps a speech-analysis submission reservation pending', async () => {
  const store = createStore();
  const parent = voiceoverParentJob('retry_waiting');
  parent.errorCode = 'service_restarted';
  parent.cancelRequestedAt = 2_000;
  parent.result.voiceoverCheckpoint = {
    version: 1,
    stage: 'speech_analysis_submitting',
    baseVideoAssetId: 'asset-base',
    originalAudioAssetId: 'asset-original',
    vocalAssetId: 'asset-vocal',
    backgroundAssetId: 'asset-background',
    analysisEvidenceVersion: VOICEOVER_ANALYSIS_EVIDENCE_VERSION,
    analysisAttempt: 0,
  };
  store.jobs = [parent];
  let releaseDecision = null;
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    mutateStore: async (operation) => operation(store),
    executeJob: async (_job, signal) => {
      assert.equal(signal.aborted, true);
      throw Object.assign(new Error('cancelled after restart'), {
        code: 'request_cancelled',
      });
    },
    createLog: async () => {},
    findUserById: () => store.users[0],
    releaseJobCredits: ({ job, error, retryWaiting }) => {
      releaseDecision = shouldReleaseJobCreditReservation({
        job,
        error,
        retryWaiting,
      });
    },
  });

  const result = await activities.executeLocalJobAttemptActivity({
    jobId: parent.id,
    workflowId: 'voiceover-analysis-restarted-workflow',
    runId: 'run-1',
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.errorCode, 'request_cancelled');
  assert.equal(releaseDecision, false);
});

test('local temporal activity cannot complete or fail a newer running claim', async () => {
  for (const outcome of ['complete', 'fail']) {
    const store = createStore();
    store.jobs = [voiceoverParentJob()];
    const creditFinalizations = [];
    const activities = createLocalTemporalActivities({
      readStore: () => store,
      writeStore: () => {},
      mutateStore: async (operation) => operation(store),
      executeJob: async (claimedJob) => {
        const current = store.jobs.find((job) => job.id === claimedJob.id);
        Object.assign(current, {
          status: 'running',
          startedAt: Number(claimedJob.startedAt) + 1,
          result: { newerClaim: outcome },
          errorCode: '',
          errorMessage: '',
        });
        if (outcome === 'fail') {
          throw Object.assign(new Error('stale executor failed'), { code: 'provider_network_error' });
        }
        return { result: { staleExecutor: true } };
      },
      createLog: async () => {},
      findUserById: () => store.users[0],
      settleJobCredits: () => creditFinalizations.push('settle'),
      releaseJobCredits: () => creditFinalizations.push('release'),
    });

    const result = await activities.executeLocalJobAttemptActivity({
      jobId: 'voiceover-parent-temporal',
    });
    assert.equal(result.status, 'running', outcome);
    assert.equal(store.jobs[0].status, 'running', outcome);
    assert.equal(store.jobs[0].result.newerClaim, outcome);
    assert.equal(store.jobs[0].result.staleExecutor, undefined);
    assert.equal(store.jobs[0].errorCode, '', outcome);
    assert.deepEqual(creditFinalizations, [], outcome);
  }
});

test('local temporal activity treats deletion during execution as a stale claim', async () => {
  for (const outcome of ['complete', 'fail']) {
    const store = createStore();
    store.jobs = [voiceoverParentJob()];
    const creditFinalizations = [];
    const activities = createLocalTemporalActivities({
      readStore: () => store,
      writeStore: () => {},
      mutateStore: async (operation) => operation(store),
      executeJob: async () => {
        store.jobs = [];
        if (outcome === 'fail') {
          throw Object.assign(new Error('deleted executor failed'), {
            code: 'provider_network_error',
          });
        }
        return { result: { deletedExecutor: true } };
      },
      createLog: (entry) => store.logs.push(entry),
      findUserById: () => store.users[0],
      settleJobCredits: () => creditFinalizations.push('settle'),
      releaseJobCredits: () => creditFinalizations.push('release'),
    });

    const result = await activities.executeLocalJobAttemptActivity({
      jobId: 'voiceover-parent-temporal',
    });

    assert.equal(result.jobId, 'voiceover-parent-temporal', outcome);
    assert.equal(result.status, 'running', outcome);
    assert.deepEqual(store.jobs, [], outcome);
    assert.deepEqual(creditFinalizations, [], outcome);
    assert.deepEqual(store.logs, [], outcome);
  }
});

test('local temporal activity refuses to claim a parent-owned child', async () => {
  const store = createStore();
  store.jobs = [parentOwnedTemporalChild()];
  let executeCalls = 0;
  const activities = createLocalTemporalActivities({
    readStore: () => store,
    writeStore: () => {},
    mutateStore: async (operation) => operation(store),
    executeJob: async () => { executeCalls += 1; },
    createLog: async () => {},
    findUserById: () => store.users[0],
  });

  const result = await activities.executeLocalJobAttemptActivity({ jobId: 'voiceover-child-temporal' });
  assert.equal(result.status, 'queued');
  assert.equal(store.jobs[0].status, 'queued');
  assert.equal(executeCalls, 0);
});

test('mysql temporal abort finalization receives the latest submitted child checkpoint', async () => {
  const parent = voiceoverParentJob();
  parent.payload.removeText = true;
  const { state, pool } = createMysqlHarness({
    id: parent.id,
    user_id: parent.userId,
    module: parent.module,
    task_type: parent.taskType,
    provider: parent.provider,
    status: 'queued',
    priority: 0,
    payload_json: JSON.stringify(parent.payload),
    result_json: JSON.stringify(parent.result),
    retry_count: 0,
    max_retries: 0,
    created_at: 1_000,
    updated_at: 1_000,
    cancel_requested_at: 900,
  });
  const sideEffects = [];
  const creditJobs = [];
  const activities = createMysqlTemporalActivities({
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
      assert.equal(JSON.parse(state.job.result_json).voiceoverCheckpoint.stage, 'subtitle_removal');
      sideEffects.push('paid-call');
      return { result: { ignoredOnCancel: true } };
    },
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', jobConcurrency: 1 }),
    settleJobCredits: ({ job: creditJob }) => creditJobs.push(creditJob),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: parent.id,
    workflowId: 'workflow-parent',
    runId: 'run-parent',
  });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(sideEffects, ['paid-call']);
  assert.equal(JSON.parse(state.job.result_json).audit, 'keep');
  assert.equal(JSON.parse(state.job.result_json).voiceoverCheckpoint.stage, 'subtitle_removal');
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

test('mysql temporal activity cannot complete or fail after its terminal claim guard loses a race', async () => {
  for (const outcome of ['complete', 'fail']) {
    const parent = voiceoverParentJob();
    const harness = createMysqlHarness({
      id: parent.id,
      user_id: parent.userId,
      module: parent.module,
      task_type: parent.taskType,
      provider: parent.provider,
      status: 'queued',
      priority: 0,
      payload_json: JSON.stringify(parent.payload),
      result_json: JSON.stringify(parent.result),
      retry_count: 0,
      max_retries: 0,
      created_at: 1_000,
      updated_at: 1_000,
    });
    const creditFinalizations = [];
    const activities = createMysqlTemporalActivities({
      getPool: async () => harness.pool,
      executeJob: async () => {
        harness.driftBeforeTerminalUpdate();
        if (outcome === 'fail') {
          throw Object.assign(new Error('stale executor failed'), { code: 'provider_network_error' });
        }
        return { result: { staleExecutor: true } };
      },
      createLog: async () => {},
      findUserById: async () => ({ id: 'user-1', jobConcurrency: 1 }),
      settleJobCredits: () => creditFinalizations.push('settle'),
      releaseJobCredits: () => creditFinalizations.push('release'),
    });

    const result = await activities.executeMysqlJobAttemptActivity({
      jobId: parent.id,
      workflowId: `workflow-stale-${outcome}`,
      runId: `run-stale-${outcome}`,
    });
    assert.equal(result.status, 'running', outcome);
    assert.equal(harness.state.job.status, 'running', outcome);
    assert.deepEqual(JSON.parse(harness.state.job.result_json), { newerClaim: true }, outcome);
    assert.equal(harness.state.job.error_code, null, outcome);
    assert.deepEqual(creditFinalizations, [], outcome);
    assert.equal(harness.state.attemptFinishes, 0, outcome);
    assert.equal(
      harness.state.events.some((params) => ['job_completed', 'job_failed'].includes(params[5])),
      false,
      outcome,
    );
  }
});

test('mysql temporal activity refuses to claim a parent-owned child', async () => {
  const child = parentOwnedTemporalChild();
  const { state, pool } = createMysqlHarness({
    id: child.id,
    user_id: child.userId,
    module: child.module,
    task_type: child.taskType,
    provider: child.provider,
    status: child.status,
    priority: 0,
    payload_json: JSON.stringify(child.payload),
    retry_count: 0,
    max_retries: 0,
    created_at: 1_000,
    updated_at: 1_000,
  });
  let executeCalls = 0;
  const activities = createMysqlTemporalActivities({
    getPool: async () => pool,
    executeJob: async () => { executeCalls += 1; },
    createLog: async () => {},
    findUserById: async () => ({ id: 'user-1', jobConcurrency: 1 }),
  });

  const result = await activities.executeMysqlJobAttemptActivity({
    jobId: child.id,
    workflowId: 'workflow-child',
    runId: 'run-child',
  });
  assert.equal(result.status, 'queued');
  assert.equal(state.job.status, 'queued');
  assert.equal(executeCalls, 0);
});

test('voiceover parent always selects Temporal maximumAttempts one independently of provider', () => {
  assert.match(
    temporalWorkflowSource,
    /SINGLE_ATTEMPT_TASK_TYPES[\s\S]*voiceover_translate_video[\s\S]*input\?\.taskType[\s\S]*singleAttemptActivities/,
  );
});
