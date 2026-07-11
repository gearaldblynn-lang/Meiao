import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachLocalJobWorkflowExecution,
  claimLocalJobForExecution,
  createLocalJobRecord,
  deleteLocalJobRecord,
  findReusableLocalJobRecord,
  getLocalJobById,
  getLocalJobQueueStats,
  listLocalJobsForUser,
  markLocalJobCompleted,
  markLocalJobFailed,
  normalizeLocalJobs,
  reconcileRestartedLocalJobs,
  requestLocalCancelJob,
  requestLocalRetryJob,
  resolveLocalSubmissionUnknownJob,
  takeNextLocalExecutableJobs,
  updateLocalJobProviderTaskId,
} from './localJobStore.mjs';

const createStore = () => ({
  users: [],
  sessions: [],
  logs: [],
  appStates: {},
  jobs: [],
});

const createUser = (id = 'user-1') => ({
  id,
  username: id,
  displayName: id,
  role: 'admin',
});

test('normalizeLocalJobs returns stable empty array for invalid input', () => {
  assert.deepEqual(normalizeLocalJobs(null), []);
  assert.deepEqual(normalizeLocalJobs({}), []);
});

test('normalizeLocalJobs never evicts active work when trimming terminal history', () => {
  const active = {
    id: 'old-active-job',
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    status: 'running',
    payload: { clientSubmissionKey: 'stable-local-key' },
    createdAt: 1,
  };
  const terminal = Array.from({ length: 500 }, (_, index) => ({
    ...active,
    id: `terminal-${index}`,
    status: 'succeeded',
    payload: {},
    createdAt: index + 2,
  }));

  const normalized = normalizeLocalJobs([...terminal, active]);

  assert.equal(normalized.length, 500);
  assert.ok(normalized.some((job) => job.id === active.id));
  assert.equal(normalized.filter((job) => job.status === 'succeeded').length, 499);
});

test('local explicit submission key reuses an active job outside the ordinary dedupe window', () => {
  const store = createStore();
  const user = createUser('user-a');
  store.jobs.push({
    id: 'old-active-job',
    userId: user.id,
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    status: 'running',
    payload: { clientSubmissionKey: 'stable-local-key' },
    createdAt: 1,
  });

  const matched = findReusableLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { clientSubmissionKey: 'stable-local-key', prompt: 'same semantic input' },
  }, 1);

  assert.equal(matched?.id, 'old-active-job');
});

test('local admin can release a verified submission-unknown reservation', () => {
  const store = createStore();
  store.jobs.push({
    id: 'local-submission-unknown',
    userId: 'user-a',
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'failed',
    providerTaskId: 'non-queryable-response-id',
    errorCode: 'provider_submission_unknown',
    errorMessage: 'unknown',
    payload: {},
    retryCount: 0,
    maxRetries: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  let releasedJobId = '';

  const result = resolveLocalSubmissionUnknownJob(store, {
    jobId: 'local-submission-unknown',
    action: 'release',
    releaseReservation: (job) => { releasedJobId = job.id; },
  });

  assert.equal(releasedJobId, 'local-submission-unknown');
  assert.equal(result.job.errorCode, 'provider_submission_released');
});

test('createLocalJobRecord stores queued job with default retry fields', () => {
  const store = createStore();
  const user = createUser();

  const job = createLocalJobRecord(store, user, {
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { imageUrls: ['https://example.com/a.png'] },
  });

  assert.equal(store.jobs.length, 1);
  assert.equal(job.userId, user.id);
  assert.equal(job.status, 'queued');
  assert.equal(job.retryCount, 0);
  assert.equal(job.maxRetries, 2);
  assert.deepEqual(job.payload, { imageUrls: ['https://example.com/a.png'] });
});

test('createLocalJobRecord checkpoints an existing provider task for recovery', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'dreamina_video',
    provider: 'dreamina',
    providerTaskId: 'dreamina-submit-1',
    payload: { providerTaskId: 'dreamina-submit-1' },
    maxRetries: 0,
  });

  assert.equal(job.providerTaskId, 'dreamina-submit-1');
  assert.equal(job.maxRetries, 0);
});

test('listLocalJobsForUser returns latest jobs first and respects limit', () => {
  const store = createStore();
  const user = createUser();

  const first = createLocalJobRecord(store, user, { module: 'a', taskType: 't1', provider: 'kie', payload: {} });
  const second = createLocalJobRecord(store, user, { module: 'b', taskType: 't2', provider: 'kie', payload: {} });

  const jobs = listLocalJobsForUser(store, user.id, { limit: 1 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, second.id);
  assert.notEqual(jobs[0].id, first.id);
});

test('deleteLocalJobRecord removes a job from the local store', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, { module: 'one_click', taskType: 'kie_image', provider: 'kie', payload: {} });

  const deleted = deleteLocalJobRecord(store, job.id);

  assert.equal(deleted.id, job.id);
  assert.equal(getLocalJobById(store, job.id), null);
  assert.deepEqual(listLocalJobsForUser(store, user.id), []);
});

test('requestLocalCancelJob cancels queued jobs immediately', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, { module: 'translation', taskType: 'kie_image', provider: 'kie', payload: {} });

  const cancelled = requestLocalCancelJob(store, job.id);

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.errorCode, 'request_cancelled');
  assert.equal(typeof cancelled.finishedAt, 'number');
});

test('requestLocalRetryJob resets failed job back to queued', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, { module: 'translation', taskType: 'kie_image', provider: 'kie', payload: {} });
  job.status = 'failed';
  job.errorCode = 'provider_timeout';
  job.errorMessage = 'timeout';
  job.finishedAt = Date.now();
  job.startedAt = Date.now();
  job.result = { imageUrl: 'https://example.com/a.png' };

  const retried = requestLocalRetryJob(store, job.id);

  assert.equal(retried.status, 'queued');
  assert.equal(retried.errorCode, '');
  assert.equal(retried.errorMessage, '');
  assert.equal(retried.finishedAt, null);
  assert.equal(retried.startedAt, null);
  assert.equal(retried.result, null);
});

test('requestLocalRetryJob attaches replacement reservation payload before queuing', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: { __creditReservation: { id: 'old-reservation', userId: user.id, amount: 5 } },
    maxRetries: 2,
  });
  job.status = 'failed';

  const retried = requestLocalRetryJob(store, job.id, {
    payload: {
      __creditReservation: { id: 'new-reservation', userId: user.id, amount: 5 },
      prompt: 'same prompt',
    },
    maxRetries: 0,
  });

  assert.equal(retried.status, 'queued');
  assert.equal(retried.maxRetries, 0);
  assert.equal(retried.payload.__creditReservation.id, 'new-reservation');
  assert.equal(retried.payload.prompt, 'same prompt');
});

test('requestLocalRetryJob clears an old provider task id only for true resubmission', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    providerTaskId: 'old-provider-task',
    payload: {},
    maxRetries: 0,
  });
  job.status = 'failed';
  job.retryCount = 2;

  const recoveryRetry = requestLocalRetryJob(store, job.id);
  assert.equal(recoveryRetry.providerTaskId, 'old-provider-task');

  recoveryRetry.status = 'failed';
  const resubmissionRetry = requestLocalRetryJob(store, job.id, { resetProviderTaskId: true });
  assert.equal(resubmissionRetry.providerTaskId, '');
  assert.equal(resubmissionRetry.retryCount, 0);
});

test('takeNextLocalExecutableJobs marks queued jobs as running in priority order', () => {
  const store = createStore();
  const user = createUser();
  const low = createLocalJobRecord(store, user, { module: 'a', taskType: 't1', provider: 'kie', payload: {}, priority: 1 });
  const high = createLocalJobRecord(store, user, { module: 'b', taskType: 't2', provider: 'kie', payload: {}, priority: 9 });

  const claimed = takeNextLocalExecutableJobs(store, 1);

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, high.id);
  assert.equal(getLocalJobById(store, high.id).status, 'running');
  assert.equal(getLocalJobById(store, low.id).status, 'queued');
});

test('takeNextLocalExecutableJobs respects per-user concurrency limits', () => {
  const store = createStore();
  const userA = { ...createUser('user-a'), jobConcurrency: 1 };
  const userB = { ...createUser('user-b'), jobConcurrency: 2 };
  const a1 = createLocalJobRecord(store, userA, { module: 'a', taskType: 't1', provider: 'kie', payload: {}, priority: 10 });
  const a2 = createLocalJobRecord(store, userA, { module: 'a', taskType: 't2', provider: 'kie', payload: {}, priority: 9 });
  const b1 = createLocalJobRecord(store, userB, { module: 'b', taskType: 't3', provider: 'kie', payload: {}, priority: 1 });

  const claimed = takeNextLocalExecutableJobs(store, 3, {
    getUserConcurrency: (userId) => (userId === 'user-a' ? 1 : 2),
  });

  assert.equal(claimed.length, 2);
  assert.deepEqual(claimed.map((job) => job.id), [a1.id, b1.id]);
  assert.equal(getLocalJobById(store, a1.id).status, 'running');
  assert.equal(getLocalJobById(store, a2.id).status, 'queued');
  assert.equal(getLocalJobById(store, b1.id).status, 'running');
});

test('claimLocalJobForExecution claims one queued job without sweeping other running jobs', () => {
  const store = createStore();
  const user = createUser();
  const target = createLocalJobRecord(store, user, { module: 'a', taskType: 't1', provider: 'kie', payload: {} });
  const alreadyRunning = createLocalJobRecord(store, user, { module: 'b', taskType: 't2', provider: 'kie', payload: {} });
  alreadyRunning.status = 'running';
  alreadyRunning.startedAt = Date.now() - 10000;

  const claimed = claimLocalJobForExecution(store, target.id);

  assert.equal(claimed.id, target.id);
  assert.equal(claimed.status, 'running');
  assert.equal(getLocalJobById(store, alreadyRunning.id).status, 'running');
});

test('attachLocalJobWorkflowExecution stores workflow identity outside payload', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'a',
    taskType: 't1',
    provider: 'kie',
    payload: { traceId: 'trace-1' },
  });

  const updated = attachLocalJobWorkflowExecution(store, job.id, {
    workflowId: 'wf-1',
    runId: 'run-1',
  }, {
    engine: 'temporal',
    executionMode: 'execute',
  });

  assert.equal(updated.workflowId, 'wf-1');
  assert.equal(updated.runId, 'run-1');
  assert.equal(updated.taskEngine, 'temporal');
  assert.equal(updated.workflowExecutionMode, 'execute');
  assert.deepEqual(updated.payload, { traceId: 'trace-1' });
});

test('getLocalJobQueueStats counts queued and running jobs', () => {
  const store = createStore();
  const user = createUser();
  const queued = createLocalJobRecord(store, user, { module: 'a', taskType: 't1', provider: 'kie', payload: {} });
  const retryWaiting = createLocalJobRecord(store, user, { module: 'b', taskType: 't2', provider: 'kie', payload: {} });
  const running = createLocalJobRecord(store, user, { module: 'c', taskType: 't3', provider: 'kie', payload: {} });

  retryWaiting.status = 'retry_waiting';
  running.status = 'running';

  assert.deepEqual(getLocalJobQueueStats(store), {
    queued: 2,
    running: 1,
  });
  assert.equal(queued.status, 'queued');
});

test('reconcileRestartedLocalJobs never resubmits providerless running jobs after restart', () => {
  const store = createStore();
  const user = createUser();
  const providerless = createLocalJobRecord(store, user, { module: 'a', taskType: 'kie_video', provider: 'kie', payload: {} });
  const submitted = createLocalJobRecord(store, user, { module: 'a', taskType: 'kie_video', provider: 'kie', payload: {} });
  const storedProviderless = store.jobs.find((job) => job.id === providerless.id);
  const storedSubmitted = store.jobs.find((job) => job.id === submitted.id);
  storedProviderless.status = 'running';
  storedProviderless.startedAt = Date.now() - 10000;
  storedSubmitted.status = 'running';
  storedSubmitted.providerTaskId = 'provider-task-1';
  storedSubmitted.startedAt = Date.now() - 10000;

  const reconciled = reconcileRestartedLocalJobs(store.jobs);
  const failed = reconciled.find((job) => job.id === providerless.id);
  const recoverable = reconciled.find((job) => job.id === submitted.id);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'provider_submission_unknown');
  assert.equal(typeof failed.finishedAt, 'number');
  assert.match(failed.errorMessage, /防止重复扣费/);
  assert.equal(recoverable.status, 'retry_waiting');
  assert.equal(recoverable.finishedAt, null);
  assert.match(recoverable.errorMessage, /服务重启/);
});

test('reconcileRestartedLocalJobs safely requeues providerless internal work', () => {
  const store = createStore();
  const user = createUser();
  const internalJob = createLocalJobRecord(store, user, {
    module: 'system',
    taskType: 'future_internal_maintenance',
    provider: 'internal',
    payload: {},
  });
  internalJob.status = 'running';
  internalJob.startedAt = Date.now() - 10000;

  const [reconciled] = reconcileRestartedLocalJobs(store.jobs);
  assert.equal(reconciled.status, 'retry_waiting');
  assert.equal(reconciled.errorCode, 'service_restarted');
  assert.equal(reconciled.finishedAt, null);
});

test('reconcileRestartedLocalJobs does not retry a non-queryable kie chat response id', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    providerTaskId: 'chat-response-id',
    payload: { subFeature: 'storyboard' },
  });
  job.status = 'running';

  const [reconciled] = reconcileRestartedLocalJobs(store.jobs);
  assert.equal(reconciled.status, 'failed');
  assert.equal(reconciled.errorCode, 'provider_submission_unknown');
});

test('markLocalJobFailed keeps providerTaskId for later recovery', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, { module: 'translation', taskType: 'kie_image', provider: 'kie', payload: {} });

  const failed = markLocalJobFailed(store, job.id, {
    code: 'task_not_found',
    message: '任务不存在。',
    providerTaskId: 'kie-task-123',
  });

  assert.equal(failed.providerTaskId, 'kie-task-123');
});

test('local kie chat failure keeps its response id but never resubmits it as a recoverable task', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: { model: 'gemini-3-flash-openai' },
    maxRetries: 1,
  });
  job.status = 'running';

  const failed = markLocalJobFailed(store, job.id, {
    code: 'provider_internal_error',
    message: 'Gemini chat (OpenAI format) responseCode error: 504',
    providerTaskId: '4222457f0143802a0a57e5da7e6e1512',
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryCount, 0);
  assert.equal(failed.providerTaskId, '4222457f0143802a0a57e5da7e6e1512');
  // S2 Task G2:errorMessage 变人话,技术原文迁到 errorDetail(不丢信息)
  assert.equal(failed.errorMessage, '生成服务暂时异常，请稍后重试');
  assert.match(failed.errorDetail, /responseCode error: 504/);
  assert.equal(typeof failed.finishedAt, 'number');
  assert.deepEqual(takeNextLocalExecutableJobs(store, 1), []);
});

test('submitted video failure uses recovery retries even when create retries are zero', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
    payload: {},
    maxRetries: 0,
  });
  job.status = 'running';
  job.providerTaskId = 'provider-task-1';

  const recovery = markLocalJobFailed(store, job.id, {
    code: 'provider_timeout',
    message: 'poll timeout',
    providerStage: 'polling',
    providerTaskId: 'provider-task-1',
  });

  assert.equal(recovery.status, 'retry_waiting');
  assert.equal(recovery.retryCount, 1);
  assert.equal(recovery.providerTaskId, 'provider-task-1');
  assert.equal(recovery.finishedAt, null);
});

test('provider task checkpoint resets create-stage retry count for independent recovery', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, {
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    payload: {},
    maxRetries: 2,
  });
  job.status = 'running';
  job.retryCount = 2;

  const checkpointed = updateLocalJobProviderTaskId(store, job.id, 'provider-task-1');

  assert.equal(checkpointed.providerTaskId, 'provider-task-1');
  assert.equal(checkpointed.retryCount, 0);
});
