import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachLocalJobWorkflowExecution,
  claimLocalJobForExecution,
  createLocalJobRecord,
  createLocalJobWorker,
  findLocalJobByProviderTaskIdForUser,
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
  withLocalJobRetryRollback,
} from './localJobStore.mjs';
import {
  deriveVoiceoverRetryPlan,
  isParentOwnedChildJob,
} from './voiceoverChildJobStore.mjs';
import { shouldReleaseJobCreditReservation } from './accountCredits.mjs';

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

test('classic local worker leaves the store untouched while deployment drain is active', async () => {
  let readCalls = 0;
  const worker = createLocalJobWorker({
    readStore: () => {
      readCalls += 1;
      return createStore();
    },
    writeStore: () => {
      throw new Error('paused worker must not write the store');
    },
    executeJob: async () => {},
    getMaxConcurrency: () => 1,
    createLog: () => {},
    findUserById: () => null,
    isExecutionPaused: () => true,
  });

  worker.start(5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  worker.stop();

  assert.equal(readCalls, 0);
});

test('classic local worker settles provider-completed rejected output without exposing it as success', async () => {
  const store = createStore();
  const user = createUser();
  store.users.push(user);
  const job = createLocalJobRecord(store, user, {
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
      quarantinedImageAssetId: 'asset-local-1',
      imageOutputContract: { sourceWidth: 899, sourceHeight: 1750, targetWidth: 312, targetHeight: 840 },
    },
  };
  const worker = createLocalJobWorker({
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
    getMaxConcurrency: () => 1,
    createLog: () => {},
    findUserById: (userId) => store.users.find((candidate) => candidate.id === userId),
    settleJobCredits: (context) => settled.push(context),
    releaseJobCredits: (context) => released.push(context),
    isExecutionPaused: () => false,
  });

  worker.start(5);
  await new Promise((resolve) => setTimeout(resolve, 40));
  worker.stop();

  const failed = getLocalJobById(store, job.id);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.result, rejectedOutput.result);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].rejected, true);
  assert.equal(released.length, 0);
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

test('local subtitle idempotency lookup discovers a terminal job after response loss', () => {
  const store = createStore();
  const user = createUser('user-a');
  store.jobs.push({
    id: 'subtitle-terminal-job',
    userId: user.id,
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    status: 'succeeded',
    payload: { clientSubmissionKey: 'subtitle-stable-key' },
    createdAt: 1,
  });

  const matched = findReusableLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: { clientSubmissionKey: 'subtitle-stable-key' },
  }, 1);

  assert.equal(matched?.id, 'subtitle-terminal-job');
});

test('local subtitle idempotency lookup also preserves a cancelled submission identity', () => {
  const store = createStore();
  const user = createUser('user-a');
  store.jobs.push({
    id: 'subtitle-cancelled-job',
    userId: user.id,
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    status: 'cancelled',
    payload: { clientSubmissionKey: 'subtitle-stable-key' },
    createdAt: 1,
  });

  const matched = findReusableLocalJobRecord(store, user, {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: { clientSubmissionKey: 'subtitle-stable-key' },
  }, 1);

  assert.equal(matched?.id, 'subtitle-cancelled-job');
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

test('local admin can release but cannot rebind a manual provider recovery', () => {
  const createRecoveryStore = () => ({
    jobs: [{
      id: 'local-provider-recovery-manual',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'failed',
      providerTaskId: 'provider-task-1',
      errorCode: 'provider_recovery_manual',
      errorMessage: 'manual review required',
      payload: {},
      retryCount: 2,
      maxRetries: 2,
      createdAt: 1,
      updatedAt: 1,
    }],
  });

  assert.throws(() => resolveLocalSubmissionUnknownJob(createRecoveryStore(), {
    jobId: 'local-provider-recovery-manual',
    action: 'bind',
    providerTaskId: 'provider-task-1',
  }), (error) => error?.code === 'submission_resolution_bind_unsupported');

  let releasedJobId = '';
  const result = resolveLocalSubmissionUnknownJob(createRecoveryStore(), {
    jobId: 'local-provider-recovery-manual',
    action: 'release',
    releaseReservation: (job) => { releasedJobId = job.id; },
  });
  assert.equal(releasedJobId, 'local-provider-recovery-manual');
  assert.equal(result.resolutionKind, 'provider_recovery');
  assert.equal(result.job.errorCode, 'provider_recovery_released');
});

test('local admin can settle a verified successful manual recovery', () => {
  const store = {
    jobs: [{
      id: 'local-provider-recovery-settle',
      userId: 'user-a',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'failed',
      providerTaskId: 'provider-task-success',
      errorCode: 'provider_recovery_manual',
      errorMessage: 'manual review required',
      payload: {},
      retryCount: 2,
      maxRetries: 2,
      createdAt: 1,
      updatedAt: 1,
    }],
  };
  let settlementInput = null;
  const result = resolveLocalSubmissionUnknownJob(store, {
    jobId: 'local-provider-recovery-settle',
    action: 'settle',
    actualCreditsConsumed: 2,
    verificationNote: 'provider console verified',
    settleReservation: (job, input) => {
      settlementInput = { jobId: job.id, ...input };
      return { settledAmount: input.actualCreditsConsumed };
    },
  });
  assert.deepEqual(settlementInput, {
    jobId: 'local-provider-recovery-settle',
    actualCreditsConsumed: 2,
    verificationNote: 'provider console verified',
  });
  assert.equal(result.action, 'settle');
  assert.equal(result.job.errorCode, 'provider_recovery_settled');
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

test('local provider recovery lookup never crosses user ownership', () => {
  const store = createStore();
  const user1Job = createLocalJobRecord(store, { id: 'user-1' }, {
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    providerTaskId: 'provider-task-1',
    payload: {},
  });
  createLocalJobRecord(store, { id: 'user-2' }, {
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    providerTaskId: 'provider-task-2',
    payload: {},
  });
  const previousRecovery = createLocalJobRecord(store, { id: 'user-1' }, {
    module: 'one_click',
    taskType: 'kie_recover',
    provider: 'kie',
    providerTaskId: 'provider-task-1',
    payload: { isVideo: false },
  });
  previousRecovery.createdAt = user1Job.createdAt + 100;

  assert.equal(
    findLocalJobByProviderTaskIdForUser(store, 'user-1', 'provider-task-1')?.id,
    user1Job.id,
  );
  assert.equal(findLocalJobByProviderTaskIdForUser(store, 'user-1', 'provider-task-2'), null);
  assert.equal(findLocalJobByProviderTaskIdForUser(store, 'user-2', 'provider-task-1'), null);
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

test('local retry rollback restores job, account reservation, and ledger after workflow start failure', async () => {
  const store = createStore();
  store.users = [{
    ...createUser(),
    creditBalance: 10,
    creditReserved: 0,
  }];
  store.jobs = [{
    id: 'job-retry-rollback',
    status: 'failed',
    result: { voiceoverCheckpoint: { stage: 'input_prepared' } },
  }];
  store.accountCreditLedger = [];
  const original = structuredClone(store);
  let persistedSnapshot = null;

  await assert.rejects(
    withLocalJobRetryRollback(store, async () => {
      store.jobs[0].status = 'queued';
      store.users[0].creditReserved = 5;
      store.accountCreditLedger.push({ action: 'reserve', amount: 5 });
      throw Object.assign(new Error('workflow unavailable'), {
        code: 'job_workflow_start_failed',
      });
    }, {
      persist: (restoredStore) => {
        persistedSnapshot = structuredClone(restoredStore);
      },
    }),
    (error) => error?.code === 'job_workflow_start_failed',
  );

  assert.deepEqual(store, original);
  assert.deepEqual(persistedSnapshot, original);

  await assert.rejects(
    withLocalJobRetryRollback(store, async () => {
      store.jobs[0].status = 'queued';
      throw Object.assign(new Error('primary workflow failure'), {
        code: 'job_workflow_start_failed',
      });
    }, {
      persist: () => {
        throw new Error('rollback persistence failed');
      },
    }),
    (error) => error?.code === 'job_workflow_start_failed',
  );
  assert.deepEqual(store, original);

  await assert.rejects(
    withLocalJobRetryRollback(store, async () => {
      store.jobs[0].status = 'queued';
      throw 'primitive failure';
    }, {
      persist: () => {
        throw new Error('rollback persistence failed');
      },
    }),
    (error) => error === 'primitive failure',
  );
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

test('local restart then cancel keeps a speech-analysis submission reservation pending', () => {
  const parent = {
    id: 'voiceover-analysis-restarted-local',
    userId: 'user-1',
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
    startedAt: 1000,
  };
  const [restarted] = reconcileRestartedLocalJobs([parent], 2000);
  const store = { jobs: [restarted] };
  const cancelled = requestLocalCancelJob(store, parent.id);

  assert.equal(restarted.errorCode, 'service_restarted');
  assert.equal(cancelled.errorCode, 'request_cancelled');
  assert.equal(shouldReleaseJobCreditReservation({
    job: cancelled,
    error: { code: 'request_cancelled' },
  }), false);
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

test('local terminal helpers treat a missing expected claim as job_state_changed', () => {
  const store = createStore();
  const expectedClaim = {
    id: 'deleted-running-job',
    userId: 'user-1',
    startedAt: 1_000,
  };

  assert.throws(
    () => markLocalJobCompleted(
      store,
      expectedClaim.id,
      { result: { stale: true } },
      false,
      expectedClaim,
    ),
    (error) => error.code === 'job_state_changed' && error.statusCode === 409,
  );
  assert.throws(
    () => markLocalJobFailed(
      store,
      expectedClaim.id,
      Object.assign(new Error('stale failure'), { code: 'provider_network_error' }),
      expectedClaim,
    ),
    (error) => error.code === 'job_state_changed' && error.statusCode === 409,
  );

  assert.equal(markLocalJobCompleted(store, expectedClaim.id, { result: {} }), null);
  assert.equal(markLocalJobFailed(store, expectedClaim.id, new Error('missing')), null);
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

const createVoiceoverParent = (overrides = {}) => ({
  id: 'voiceover-parent-1',
  userId: 'user-1',
  module: 'video',
  taskType: 'voiceover_translate_video',
  provider: 'internal',
  status: 'running',
  priority: 0,
  payload: {
    taskPurpose: 'voiceover_translation',
    removeText: false,
  },
  result: {
    audit: 'keep',
    voiceoverCheckpoint: {
      version: 1,
      stage: 'input_prepared',
      baseVideoAssetId: 'asset-base',
      analysisAttempt: 0,
    },
  },
  providerTaskId: '',
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1,
  updatedAt: 2,
  startedAt: 2,
  finishedAt: null,
  cancelRequestedAt: null,
  ...overrides,
});

const createParentOwnedChild = (overrides = {}) => ({
  id: 'voiceover-child-1',
  userId: 'user-1',
  module: 'video',
  taskType: 'kie_tts',
  provider: 'kie',
  status: 'succeeded',
  priority: 0,
  payload: {
    executionOwner: 'parent',
    parentJobId: 'voiceover-parent-1',
    childKey: 'tts:0:attempt:0',
    clientSubmissionKey: 'voiceover-child:voiceover-parent-1:tts:0:attempt:0',
  },
  providerTaskId: 'provider-1',
  result: { assetId: 'asset-tts', audioUrl: '/api/assets/file/asset-tts' },
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1,
  updatedAt: 2,
  startedAt: 1,
  finishedAt: 2,
  cancelRequestedAt: null,
  ...overrides,
});

test('local generic execution, restart recovery, queue stats, and user listing exclude parent-owned children', () => {
  const parent = createVoiceoverParent({ status: 'queued', startedAt: null });
  const child = createParentOwnedChild({ status: 'running', finishedAt: null });
  const store = createStore();
  store.jobs = [parent, child];

  assert.equal(isParentOwnedChildJob(child), true);
  assert.deepEqual(takeNextLocalExecutableJobs(store, 2).map((job) => job.id), [parent.id]);
  assert.deepEqual(getLocalJobQueueStats(store), { queued: 0, running: 1 });
  assert.deepEqual(listLocalJobsForUser(store, 'user-1').map((job) => job.id), [parent.id]);
  const reconciledChild = reconcileRestartedLocalJobs([child])[0];
  assert.equal(reconciledChild.status, 'running');
  assert.equal(claimLocalJobForExecution({ jobs: [child] }, child.id), null);
});

test('local generic cancel, retry, and delete cannot mutate a parent-owned child', () => {
  const operations = [
    {
      name: 'cancel',
      child: createParentOwnedChild({ status: 'queued' }),
      run: (store, child) => requestLocalCancelJob(store, child.id),
    },
    {
      name: 'retry',
      child: createParentOwnedChild({ status: 'failed', finishedAt: 2_000 }),
      run: (store, child) => requestLocalRetryJob(store, child.id),
    },
    {
      name: 'delete',
      child: createParentOwnedChild({ status: 'succeeded', finishedAt: 2_000 }),
      run: (store, child) => deleteLocalJobRecord(store, child.id),
    },
  ];

  for (const operation of operations) {
    const store = { jobs: normalizeLocalJobs([structuredClone(operation.child)]) };
    const before = structuredClone(store.jobs);
    assert.throws(
      () => operation.run(store, operation.child),
      (error) => error.code === 'parent_owned_child_immutable',
      operation.name,
    );
    assert.deepEqual(store.jobs, before, operation.name);
  }
});

test('local compaction retains a terminal parent-owned child while its parent remains nonterminal', () => {
  const parent = createVoiceoverParent({ status: 'retry_waiting', startedAt: null });
  const requiredChild = createParentOwnedChild({ createdAt: 1 });
  const crowdedHistory = Array.from({ length: 600 }, (_, index) => ({
    ...createParentOwnedChild({
      id: `ordinary-${index}`,
      taskType: 'local_probe',
      provider: 'internal',
      payload: {},
      createdAt: index + 2,
    }),
  }));
  const normalized = normalizeLocalJobs([...crowdedHistory, requiredChild, parent]);

  assert.ok(normalized.some((job) => job.id === requiredChild.id));
  assert.ok(normalized.some((job) => job.id === parent.id));
});

test('local voiceover retry preserves checkpoint and only server-confirmed analysis retry rewinds it', () => {
  const reusableStore = createStore();
  reusableStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 3,
    errorCode: 'voiceover_mix_failed',
  })];
  const reused = requestLocalRetryJob(reusableStore, 'voiceover-parent-1', {
    voiceoverRetryPlan: { kind: 'reuse' },
  });
  assert.equal(reused.result.audit, 'keep');
  assert.equal(reused.result.voiceoverCheckpoint.stage, 'input_prepared');

  const analysisStore = createStore();
  analysisStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 3,
    errorCode: 'voiceover_analysis_submission_unknown',
    result: {
      audit: 'keep',
      voiceoverCheckpoint: {
        version: 1,
        stage: 'speech_analysis_submitting',
        baseVideoAssetId: 'asset-base',
        originalAudioAssetId: 'asset-audio',
        vocalAssetId: 'asset-vocal',
        backgroundAssetId: 'asset-background',
        analysisAttempt: 0,
      },
    },
  })];
  assert.throws(
    () => requestLocalRetryJob(analysisStore, 'voiceover-parent-1', {
      voiceoverRetryPlan: { kind: 'analysis', userConfirmed: false },
    }),
    (error) => error.code === 'voiceover_analysis_submission_unknown',
  );
  const retried = requestLocalRetryJob(analysisStore, 'voiceover-parent-1', {
    voiceoverRetryPlan: { kind: 'analysis', userConfirmed: true },
  });
  assert.equal(retried.result.audit, 'keep');
  assert.equal(retried.result.voiceoverCheckpoint.stage, 'voice_separated');
  assert.equal(retried.result.voiceoverCheckpoint.analysisAttempt, 1);
});

test('local voiceover retry safely requeues a cancelled query-only child attempt', () => {
  const store = createStore();
  store.jobs = [createVoiceoverParent({
    status: 'cancelled',
    startedAt: null,
    finishedAt: 3,
    errorCode: 'request_cancelled',
    payload: {
      taskPurpose: 'voiceover_translation',
      removeText: true,
    },
    result: {
      voiceoverCheckpoint: {
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
      },
    },
  })];
  const retried = requestLocalRetryJob(store, 'voiceover-parent-1', {
    voiceoverRetryPlan: { kind: 'reuse' },
  });
  assert.equal(retried.status, 'queued');
  assert.equal(
    retried.result.voiceoverCheckpoint.subtitleRemoval.providerTaskId,
    'golden-provider-0',
  );
});

test('local voiceover paid retry derives the next TTS attempt once from the durable checkpoint', () => {
  const segment = {
    id: 's1',
    startMs: 0,
    endMs: 800,
    sourceText: '源文',
    targetText: 'Translation',
  };
  const store = createStore();
  store.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 3,
    errorCode: 'provider_submission_unknown',
    result: {
      audit: 'keep',
      voiceoverCheckpoint: {
        version: 1,
        stage: 'tts_generating',
        baseVideoAssetId: 'asset-base',
        originalAudioAssetId: 'asset-audio',
        vocalAssetId: 'asset-vocal',
        backgroundAssetId: 'asset-background',
        analysisAttempt: 0,
        analysis: {
          sourceLanguage: 'cmn',
          speakerCount: 1,
          voiceProfile: {
            pitch: 'medium',
            brightness: 'balanced',
            energy: 'balanced',
            pace: 'natural',
            accentDescription: 'clear',
          },
          segments: [segment],
        },
        translation: {
          targetLanguage: 'en',
          mode: 'natural',
          selectedVoiceName: 'Kore',
          segments: [segment],
        },
        ttsGroups: [{
          index: 0,
          attempt: 0,
          childJobId: 'child-attempt-0',
          status: 'failed',
          startMs: 0,
          endMs: 800,
        }],
      },
    },
  })];
  assert.throws(
    () => requestLocalRetryJob(store, 'voiceover-parent-1', {
      voiceoverRetryPlan: { kind: 'reuse' },
    }),
    (error) => error.code === 'voiceover_retry_confirmation_required',
  );
  store.jobs[0].errorCode = 'provider_bad_request';
  assert.throws(
    () => requestLocalRetryJob(store, 'voiceover-parent-1', {
      voiceoverRetryPlan: { kind: 'reuse' },
    }),
    (error) => error.code === 'voiceover_retry_confirmation_required',
  );
  assert.throws(
    () => requestLocalRetryJob(store, 'voiceover-parent-1', {
      voiceoverRetryPlan: {
        kind: 'provider',
        target: 'tts',
        groupIndex: 0,
        userConfirmed: false,
        nextChildJobId: 'child-attempt-1',
      },
    }),
    (error) => error.code === 'voiceover_retry_confirmation_required',
  );
  const confirmedPlan = deriveVoiceoverRetryPlan(store.jobs[0], {
    confirmNewProviderAttempt: true,
  });
  const retried = requestLocalRetryJob(store, 'voiceover-parent-1', {
    voiceoverRetryPlan: confirmedPlan,
  });
  assert.equal(retried.status, 'queued');
  assert.deepEqual(
    retried.result.voiceoverCheckpoint.ttsGroups.map(({ attempt, childJobId, status }) => ({
      attempt,
      childJobId,
      status,
    })),
    [
      { attempt: 0, childJobId: 'child-attempt-0', status: 'failed' },
      { attempt: 1, childJobId: confirmedPlan.nextChildJobId, status: 'queued' },
    ],
  );
  assert.throws(
    () => requestLocalRetryJob(store, 'voiceover-parent-1', {
      voiceoverRetryPlan: {
        kind: 'provider',
        target: 'tts',
        groupIndex: 0,
        userConfirmed: true,
        nextChildJobId: 'child-attempt-2',
      },
    }),
    (error) => error.code === 'job_state_changed',
  );
});

test('local voiceover reuse follows the current provider attempt instead of historical failures', () => {
  const segment = {
    id: 's1',
    startMs: 0,
    endMs: 800,
    sourceText: '源文',
    targetText: 'Translation',
  };
  const checkpoint = {
    version: 1,
    stage: 'audio_aligned',
    baseVideoAssetId: 'asset-base',
    originalAudioAssetId: 'asset-audio',
    vocalAssetId: 'asset-vocal',
    backgroundAssetId: 'asset-background',
    analysisAttempt: 0,
    analysis: {
      sourceLanguage: 'cmn',
      speakerCount: 1,
      voiceProfile: {
        pitch: 'medium',
        brightness: 'balanced',
        energy: 'balanced',
        pace: 'natural',
        accentDescription: 'clear',
      },
      segments: [segment],
    },
    translation: {
      targetLanguage: 'en',
      mode: 'natural',
      selectedVoiceName: 'Kore',
      segments: [segment],
    },
    ttsGroups: [
      {
        index: 0,
        attempt: 0,
        childJobId: 'child-attempt-0',
        status: 'failed',
        startMs: 0,
        endMs: 800,
      },
      {
        index: 0,
        attempt: 1,
        childJobId: 'child-attempt-1',
        status: 'succeeded',
        assetId: 'asset-tts-1',
        startMs: 0,
        endMs: 800,
      },
    ],
    alignedAudioAssetId: 'asset-aligned',
  };
  const mixStore = createStore();
  mixStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 4_000,
    errorCode: 'voiceover_mix_failed',
    result: { audit: 'keep', voiceoverCheckpoint: checkpoint },
  })];
  const mixRetry = requestLocalRetryJob(mixStore, 'voiceover-parent-1', {
    voiceoverRetryPlan: { kind: 'reuse' },
  });
  assert.equal(mixRetry.status, 'queued');
  assert.equal(mixRetry.result.voiceoverCheckpoint.ttsGroups.at(-1).status, 'succeeded');

  const queryCheckpoint = {
    ...checkpoint,
    stage: 'tts_generating',
    ttsGroups: [{
      index: 0,
      attempt: 1,
      childJobId: 'child-attempt-1',
      providerTaskId: 'provider-attempt-1',
      status: 'submitted',
      startMs: 0,
      endMs: 800,
    }],
  };
  delete queryCheckpoint.alignedAudioAssetId;
  const queryStore = createStore();
  queryStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 4_000,
    providerTaskId: '',
    errorCode: 'provider_submission_unknown',
    result: {
      audit: 'keep',
      voiceoverCheckpoint: queryCheckpoint,
    },
  })];
  const queryRetry = requestLocalRetryJob(queryStore, 'voiceover-parent-1', {
    voiceoverRetryPlan: { kind: 'reuse' },
  });
  assert.equal(queryRetry.status, 'queued');
  assert.equal(
    queryRetry.result.voiceoverCheckpoint.ttsGroups.at(-1).providerTaskId,
    'provider-attempt-1',
  );

  const unknownCheckpoint = structuredClone(queryCheckpoint);
  delete unknownCheckpoint.ttsGroups[0].providerTaskId;
  const unknownStore = createStore();
  unknownStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 4_000,
    providerTaskId: 'unrelated-parent-provider',
    errorCode: 'provider_submission_unknown',
    result: {
      audit: 'keep',
      voiceoverCheckpoint: unknownCheckpoint,
    },
  })];
  assert.throws(
    () => requestLocalRetryJob(unknownStore, 'voiceover-parent-1', {
      voiceoverRetryPlan: { kind: 'reuse' },
    }),
    (error) => error.code === 'voiceover_retry_confirmation_required',
  );
});

test('local voiceover Golden reuse classifies recovery from the current child attempt provider id', () => {
  const checkpoint = {
    version: 1,
    stage: 'subtitle_removal',
    baseVideoAssetId: 'asset-base',
    subtitleRemoval: {
      childJobId: 'golden-attempt-1',
      providerTaskId: 'golden-provider-attempt-1',
      attempt: 1,
      status: 'submitted',
    },
    analysisAttempt: 0,
  };
  const recoverableStore = createStore();
  recoverableStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 4_000,
    payload: {
      taskPurpose: 'voiceover_translation',
      removeText: true,
    },
    providerTaskId: '',
    errorCode: 'provider_submission_unknown',
    result: {
      audit: 'keep',
      voiceoverCheckpoint: checkpoint,
    },
  })];

  const retried = requestLocalRetryJob(recoverableStore, 'voiceover-parent-1', {
    voiceoverRetryPlan: { kind: 'reuse' },
  });
  assert.equal(retried.status, 'queued');
  assert.equal(
    retried.result.voiceoverCheckpoint.subtitleRemoval.providerTaskId,
    'golden-provider-attempt-1',
  );

  const unknownCheckpoint = structuredClone(checkpoint);
  delete unknownCheckpoint.subtitleRemoval.providerTaskId;
  const unknownStore = createStore();
  unknownStore.jobs = [createVoiceoverParent({
    status: 'failed',
    startedAt: null,
    finishedAt: 4_000,
    payload: {
      taskPurpose: 'voiceover_translation',
      removeText: true,
    },
    providerTaskId: 'unrelated-parent-provider',
    errorCode: 'provider_submission_unknown',
    result: {
      audit: 'keep',
      voiceoverCheckpoint: unknownCheckpoint,
    },
  })];

  assert.throws(
    () => requestLocalRetryJob(unknownStore, 'voiceover-parent-1', {
      voiceoverRetryPlan: { kind: 'reuse' },
    }),
    (error) => error.code === 'voiceover_retry_confirmation_required',
  );
});

test('classic local worker awaits parent checkpoint before the next side effect and preserves it after failure', async () => {
  const store = createStore();
  store.users.push(createUser());
  store.jobs = [createVoiceoverParent({ status: 'queued', startedAt: null })];
  const events = [];
  const worker = createLocalJobWorker({
    readStore: () => store,
    writeStore: () => {},
    mutateStore: async (operation) => operation(store),
    executeJob: async (_job, _signal, { onResultCheckpoint }) => {
      await onResultCheckpoint({
        voiceoverCheckpoint: {
          stage: 'audio_extracted',
          originalAudioAssetId: 'asset-audio',
        },
      });
      assert.equal(store.jobs[0].result.voiceoverCheckpoint.stage, 'audio_extracted');
      events.push('paid-call');
      throw Object.assign(new Error('lost'), { code: 'provider_network_error' });
    },
    getMaxConcurrency: () => 1,
    createLog: () => {},
    findUserById: (userId) => store.users.find((user) => user.id === userId),
    isExecutionPaused: () => false,
  });
  worker.start(5);
  await new Promise((resolve) => setTimeout(resolve, 50));
  worker.stop();

  assert.deepEqual(events, ['paid-call']);
  assert.equal(store.jobs[0].status, 'failed');
  assert.equal(store.jobs[0].result.audit, 'keep');
  assert.equal(store.jobs[0].result.voiceoverCheckpoint.stage, 'audio_extracted');
});

test('classic local worker cannot complete or fail a newer running claim', async () => {
  for (const outcome of ['complete', 'fail']) {
    const store = createStore();
    store.users.push(createUser());
    store.jobs = [createVoiceoverParent({ status: 'queued', startedAt: null })];
    const creditFinalizations = [];
    const worker = createLocalJobWorker({
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
      getMaxConcurrency: () => 1,
      createLog: () => {},
      findUserById: (userId) => store.users.find((user) => user.id === userId),
      settleJobCredits: () => creditFinalizations.push('settle'),
      releaseJobCredits: () => creditFinalizations.push('release'),
      isExecutionPaused: () => false,
    });
    worker.start(5);
    await new Promise((resolve) => setTimeout(resolve, 50));
    worker.stop();

    const persisted = store.jobs[0];
    assert.equal(persisted.status, 'running', outcome);
    assert.equal(persisted.result.newerClaim, outcome);
    assert.equal(persisted.result.staleExecutor, undefined);
    assert.equal(persisted.errorCode, '', outcome);
    assert.deepEqual(creditFinalizations, [], outcome);
  }
});

test('classic local worker treats deletion during execution as a stale claim', async () => {
  for (const outcome of ['complete', 'fail']) {
    const store = createStore();
    store.users.push(createUser());
    store.jobs = [createVoiceoverParent({ status: 'queued', startedAt: null })];
    const creditFinalizations = [];
    const worker = createLocalJobWorker({
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
      getMaxConcurrency: () => 1,
      createLog: (entry) => store.logs.push(entry),
      findUserById: (userId) => store.users.find((user) => user.id === userId),
      settleJobCredits: () => creditFinalizations.push('settle'),
      releaseJobCredits: () => creditFinalizations.push('release'),
      isExecutionPaused: () => false,
    });

    worker.start(5);
    await new Promise((resolve) => setTimeout(resolve, 50));
    worker.stop();

    assert.deepEqual(store.jobs, [], outcome);
    assert.deepEqual(creditFinalizations, [], outcome);
    assert.deepEqual(store.logs, [], outcome);
  }
});
