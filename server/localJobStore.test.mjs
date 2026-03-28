import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalJobRecord,
  getLocalJobById,
  getLocalJobQueueStats,
  listLocalJobsForUser,
  markLocalJobFailed,
  normalizeLocalJobs,
  reconcileRestartedLocalJobs,
  requestLocalCancelJob,
  requestLocalRetryJob,
  takeNextLocalExecutableJobs,
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

test('reconcileRestartedLocalJobs moves orphaned running jobs back to retry_waiting', () => {
  const store = createStore();
  const user = createUser();
  const job = createLocalJobRecord(store, user, { module: 'a', taskType: 't1', provider: 'kie', payload: {} });
  job.status = 'running';
  job.startedAt = Date.now() - 10000;

  const reconciled = reconcileRestartedLocalJobs(store.jobs);

  assert.equal(reconciled[0].status, 'retry_waiting');
  assert.equal(reconciled[0].finishedAt, null);
  assert.match(reconciled[0].errorMessage, /服务重启/);
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
