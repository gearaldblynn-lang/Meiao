import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createJobAttempt,
  ensureTaskPlatformSchema,
  listTaskPlatformJobs,
  normalizeTaskEngineMode,
  recordJobEvent,
} from './taskPlatform.mjs';

const createFakePool = (handler) => ({
  queries: [],
  async query(sql, params = []) {
    this.queries.push({ sql: String(sql), params });
    return handler ? handler(String(sql), params, this.queries) : [[]];
  },
});

const createJob = () => ({
  id: 'job-1',
  userId: 'user-1',
  module: 'one_click',
  taskType: 'kie_chat',
  provider: 'kie',
  status: 'running',
  payload: { requestId: 'req-1', traceId: 'trace-from-payload' },
  providerTaskId: 'task-1',
  retryCount: 1,
  maxRetries: 2,
  createdAt: 1000,
  updatedAt: 2000,
});

test('normalizeTaskEngineMode keeps mysql safe as the default engine', () => {
  assert.equal(normalizeTaskEngineMode('dual'), 'dual');
  assert.equal(normalizeTaskEngineMode('temporal'), 'temporal');
  assert.equal(normalizeTaskEngineMode('unknown'), 'mysql');
  assert.equal(normalizeTaskEngineMode(''), 'mysql');
});

test('ensureTaskPlatformSchema creates durable attempt and event tables', async () => {
  const pool = createFakePool();

  await ensureTaskPlatformSchema(pool);

  assert.match(pool.queries[0].sql, /CREATE TABLE IF NOT EXISTS internal_job_attempts/);
  assert.match(pool.queries[1].sql, /CREATE TABLE IF NOT EXISTS internal_job_events/);
  assert.match(pool.queries[0].sql, /workflow_id/);
  assert.match(pool.queries[1].sql, /provider_submitted/);
});

test('createJobAttempt increments attempt number and writes an attempt_started event', async () => {
  const job = createJob();
  const pool = createFakePool((sql) => {
    if (/MAX\(attempt_no\)/.test(sql)) return [[{ attempt_no: 1 }]];
    return [{ affectedRows: 1 }];
  });

  const attempt = await createJobAttempt(pool, job, {
    engine: 'dual',
    workflowId: 'workflow-1',
    runId: 'run-1',
  });

  assert.equal(attempt.jobId, 'job-1');
  assert.equal(attempt.attemptNo, 2);
  assert.equal(attempt.engine, 'dual');
  assert.equal(attempt.traceId, 'trace-from-payload');
  assert.equal(attempt.workflowId, 'workflow-1');
  assert.match(pool.queries[1].sql, /INSERT INTO internal_job_attempts/);
  assert.match(pool.queries[2].sql, /INSERT INTO internal_job_events/);
  assert.deepEqual(pool.queries[2].params.slice(3, 8), ['trace-from-payload', 'attempt', 'attempt_started', 'started', 'dual']);
});

test('recordJobEvent persists stage, provider submission state, retryability and fingerprint', async () => {
  const job = createJob();
  const pool = createFakePool();

  const event = await recordJobEvent(pool, job, {
    attemptId: 'attempt-1',
    attemptNo: 2,
    traceId: 'trace-1',
    stage: 'provider_submit',
    eventName: 'provider_submit_failed',
    status: 'failed',
    engine: 'mysql',
    providerSubmitted: false,
    retryable: true,
    errorCode: 'provider_timeout',
    errorMessage: 'upstream timed out',
    meta: { providerStage: 'submit', providerStatus: 'timeout' },
  });

  assert.equal(event.errorFingerprint, 'kie:kie_chat:provider_submit:provider_timeout');
  assert.match(pool.queries[0].sql, /INSERT INTO internal_job_events/);
  assert.deepEqual(pool.queries[0].params.slice(4, 12), [
    'provider_submit',
    'provider_submit_failed',
    'failed',
    'mysql',
    0,
    1,
    'provider_timeout',
    'upstream timed out',
  ]);
  assert.match(pool.queries[0].params.at(-1), /"providerStage":"submit"/);
});

test('listTaskPlatformJobs maps admin rows without changing the public job shape', async () => {
  const pool = createFakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]];
    return [[{
      id: 'job-1',
      user_id: 'user-1',
      username: 'duosang',
      display_name: '多桑',
      module: 'one_click',
      task_type: 'kie_chat',
      provider: 'kie',
      status: 'failed',
      provider_task_id: '',
      error_code: 'provider_timeout',
      error_message: 'asset upload timeout',
      retry_count: 2,
      max_retries: 2,
      created_at: 1000,
      updated_at: 2000,
      started_at: 1200,
      finished_at: 1900,
      attempt_count: 2,
      latest_attempt_status: 'failed',
      latest_stage: 'asset_upload',
      latest_event_status: 'failed',
      latest_event_at: 1800,
      provider_submitted: 0,
      retryable: 0,
      error_fingerprint: 'kie:kie_chat:asset_upload:provider_timeout',
      workflow_id: 'workflow-1',
      run_id: 'run-1',
      trace_id: 'trace-1',
    }]];
  });

  const result = await listTaskPlatformJobs(pool, { status: 'failed', page: 1, pageSize: 20 });

  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].id, 'job-1');
  assert.equal(result.jobs[0].user.displayName, '多桑');
  assert.equal(result.jobs[0].attemptCount, 2);
  assert.equal(result.jobs[0].latestStage, 'asset_upload');
  assert.equal(result.jobs[0].providerSubmitted, false);
  assert.equal(result.jobs[0].workflowId, 'workflow-1');
});
