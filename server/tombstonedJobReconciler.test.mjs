import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectTombstonedInternalJobIds,
  createTombstonedStateScanTracker,
  reconcileTombstonedJobs,
  shouldAlertTombstonedJobCleanup,
} from './tombstonedJobReconciler.mjs';

const terminalJobId = '111111111111111111111111';
const queuedJobId = '222222222222222222222222';
const runningJobId = '333333333333333333333333';
const submittedCancelledJobId = '444444444444444444444444';

test('tombstone collector accepts internal ids and job-prefixed ids only', () => {
  assert.deepEqual(collectTombstonedInternalJobIds({
    shellDraft: {
      deletedJobIds: [
        terminalJobId,
        `job-${queuedJobId}`,
        '79ea580e650c65ba86b5977bba1d8354',
        'frontend-only-id',
        terminalJobId,
      ],
    },
  }), [terminalJobId, queuedJobId]);
});

test('reconciler deletes terminal tombstones, cancels queued jobs, and leaves running jobs pending', async () => {
  const deleted = [];
  const cancelled = [];
  const stats = await reconcileTombstonedJobs({
    stateRows: [{
      userId: 'user-1',
      state: { shellDraft: { deletedJobIds: [terminalJobId, queuedJobId, runningJobId] } },
    }],
    loadJobs: async () => [
      { id: terminalJobId, userId: 'user-1', status: 'failed' },
      { id: queuedJobId, userId: 'user-1', status: 'queued' },
      { id: runningJobId, userId: 'user-1', status: 'running' },
    ],
    cancelJob: async (job) => {
      cancelled.push(job.id);
      return job.status === 'queued'
        ? { ...job, status: 'cancelled', providerTaskId: '' }
        : { ...job, cancelRequestedAt: Date.now() };
    },
    deleteJob: async (job) => {
      deleted.push(job.id);
      return { deleted: true, action: 'delete' };
    },
  });

  assert.deepEqual(cancelled.sort(), [queuedJobId, runningJobId].sort());
  assert.deepEqual(deleted.sort(), [queuedJobId, terminalJobId].sort());
  assert.deepEqual(stats, {
    desired: 3,
    found: 3,
    deleted: 2,
    cancelRequested: 2,
    recoveryRequested: 0,
    pending: 1,
    pendingReasons: {
      active: 1,
      submissionUnknown: 0,
      submittedRecovery: 0,
      recoveryManual: 0,
      pendingReservation: 0,
      other: 0,
    },
    oldestPendingUpdatedAt: null,
    oldestPendingUpdatedAtByReason: {
      active: null,
      submissionUnknown: null,
      submittedRecovery: null,
      recoveryManual: null,
      pendingReservation: null,
      other: null,
    },
    errors: 0,
  });
});

test('reconciler resumes a submitted cancelled tombstone by provider id without resubmitting it', async () => {
  const recovered = [];
  const deleted = [];
  const stats = await reconcileTombstonedJobs({
    stateRows: [{
      userId: 'user-1',
      state: { shellDraft: { deletedJobIds: [submittedCancelledJobId] } },
    }],
    loadJobs: async () => [{
      id: submittedCancelledJobId,
      userId: 'user-1',
      status: 'cancelled',
      providerTaskId: 'existing-provider-task-id',
    }],
    cancelJob: async (job) => job,
    recoverSubmittedCancelledJob: async (job) => {
      recovered.push(job.providerTaskId);
      return { ...job, status: 'retry_waiting', errorCode: 'tombstone_recovery_pending' };
    },
    deleteJob: async (job) => {
      deleted.push(job.id);
      return { deleted: true, action: 'delete' };
    },
  });

  assert.deepEqual(recovered, ['existing-provider-task-id']);
  assert.deepEqual(deleted, [], 'recovery must finish and settle credits before deletion');
  assert.deepEqual(stats, {
    desired: 1,
    found: 1,
    deleted: 0,
    cancelRequested: 0,
    recoveryRequested: 1,
    pending: 1,
    pendingReasons: {
      active: 0,
      submissionUnknown: 0,
      submittedRecovery: 1,
      recoveryManual: 0,
      pendingReservation: 0,
      other: 0,
    },
    oldestPendingUpdatedAt: null,
    oldestPendingUpdatedAtByReason: {
      active: null,
      submissionUnknown: null,
      submittedRecovery: null,
      recoveryManual: null,
      pendingReservation: null,
      other: null,
    },
    errors: 0,
  });
});

test('submitted cancellation stays query-only across cycles and deletes after terminal settlement', async () => {
  let currentJob = {
    id: submittedCancelledJobId,
    userId: 'user-1',
    status: 'cancelled',
    providerTaskId: 'existing-provider-task-id',
    payload: {},
  };
  let recoveries = 0;
  let cancellations = 0;
  let deletions = 0;
  const runCycle = () => reconcileTombstonedJobs({
    stateRows: [{
      userId: 'user-1',
      state: { shellDraft: { deletedJobIds: [submittedCancelledJobId] } },
    }],
    loadJobs: async () => [currentJob],
    cancelJob: async (job) => {
      cancellations += 1;
      return job;
    },
    recoverSubmittedCancelledJob: async (job) => {
      recoveries += 1;
      currentJob = {
        ...job,
        status: 'retry_waiting',
        payload: {
          ...job.payload,
          __tombstoneRecovery: { providerTaskId: job.providerTaskId },
        },
      };
      return currentJob;
    },
    deleteJob: async () => {
      deletions += 1;
      return { deleted: true, action: 'delete' };
    },
  });

  const first = await runCycle();
  const second = await runCycle();
  currentJob = { ...currentJob, status: 'succeeded' };
  const third = await runCycle();

  assert.equal(first.recoveryRequested, 1);
  assert.equal(second.pending, 1);
  assert.equal(third.deleted, 1);
  assert.equal(recoveries, 1, 'the same provider task is never resubmitted or rebound every cycle');
  assert.equal(cancellations, 0, 'query-only recovery must not be cancelled by the tombstone loop');
  assert.equal(deletions, 1);
});

test('financially unsettled submission-unknown tombstones stay protected and visible as manual work', async () => {
  const updatedAt = 1234;
  const stats = await reconcileTombstonedJobs({
    stateRows: [{
      userId: 'user-1',
      state: { shellDraft: { deletedJobIds: [terminalJobId] } },
    }],
    loadJobs: async () => [{
      id: terminalJobId,
      userId: 'user-1',
      status: 'failed',
      errorCode: 'provider_submission_unknown',
      pendingReservation: true,
      updatedAt,
    }],
    cancelJob: async (job) => job,
    deleteJob: async () => {
      throw new Error('submission-unknown work must not be deleted automatically');
    },
  });

  assert.equal(stats.pending, 1);
  assert.equal(stats.pendingReasons.submissionUnknown, 1);
  assert.equal(stats.oldestPendingUpdatedAt, updatedAt);
  assert.equal(stats.deleted, 0);
});

test('submission-unknown tombstones without an internal reservation honor durable deletion intent', async () => {
  const deleted = [];
  const stats = await reconcileTombstonedJobs({
    stateRows: [{
      userId: 'user-1',
      state: { shellDraft: { deletedJobIds: [terminalJobId] } },
    }],
    loadJobs: async () => [{
      id: terminalJobId,
      userId: 'user-1',
      status: 'failed',
      errorCode: 'provider_submission_unknown',
      pendingReservation: false,
    }],
    cancelJob: async (job) => job,
    deleteJob: async (job) => {
      deleted.push(job.id);
      return { deleted: true, action: 'delete' };
    },
  });

  assert.deepEqual(deleted, [terminalJobId]);
  assert.equal(stats.deleted, 1);
  assert.equal(stats.pending, 0);
});

test('manual recovery and old pending reservations make cleanup health alert', () => {
  assert.equal(shouldAlertTombstonedJobCleanup({
    errors: 0,
    pendingReasons: { recoveryManual: 1, pendingReservation: 0 },
    oldestPendingUpdatedAt: null,
  }, { now: 10_000, pendingAlertMs: 1_000 }), true);
  assert.equal(shouldAlertTombstonedJobCleanup({
    errors: 0,
    pendingReasons: { recoveryManual: 0, pendingReservation: 1 },
    oldestPendingUpdatedAtByReason: { pendingReservation: 1_000 },
  }, { now: 10_000, pendingAlertMs: 1_000 }), true);
  assert.equal(shouldAlertTombstonedJobCleanup({
    errors: 0,
    pendingReasons: { recoveryManual: 0, pendingReservation: 1 },
    oldestPendingUpdatedAtByReason: { pendingReservation: 9_500 },
  }, { now: 10_000, pendingAlertMs: 1_000 }), false);
  assert.equal(shouldAlertTombstonedJobCleanup({
    errors: 0,
    pendingReasons: { recoveryManual: 0, submissionUnknown: 1, pendingReservation: 0 },
    oldestPendingUpdatedAtByReason: { submissionUnknown: 1_000 },
  }, { now: 10_000, pendingAlertMs: 1_000 }), true);
  assert.equal(shouldAlertTombstonedJobCleanup({
    errors: 0,
    pendingReasons: { active: 1, recoveryManual: 0, submissionUnknown: 1, pendingReservation: 0 },
    oldestPendingUpdatedAt: 1_000,
    oldestPendingUpdatedAtByReason: { active: 1_000, submissionUnknown: 99_500 },
  }, { now: 100_000, pendingAlertMs: 10_000 }), false, 'an old active job must not age a fresh unknown submission');
});

test('a submitted cancellation that becomes manual recovery is reported and alerted in the same cycle', async () => {
  const updatedAt = 1_000;
  const stats = await reconcileTombstonedJobs({
    stateRows: [{
      userId: 'user-1',
      state: { shellDraft: { deletedJobIds: [submittedCancelledJobId] } },
    }],
    loadJobs: async () => [{
      id: submittedCancelledJobId,
      userId: 'user-1',
      status: 'cancelled',
      providerTaskId: 'sync-provider-response',
      updatedAt,
    }],
    recoverSubmittedCancelledJob: async (job) => ({
      ...job,
      status: 'failed',
      errorCode: 'provider_recovery_manual',
      updatedAt,
    }),
    deleteJob: async () => { throw new Error('manual recovery must not be deleted'); },
  });

  assert.equal(stats.recoveryRequested, 1);
  assert.equal(stats.pendingReasons.submittedRecovery, 0);
  assert.equal(stats.pendingReasons.recoveryManual, 1);
  assert.equal(shouldAlertTombstonedJobCleanup(stats, { now: 2_000, pendingAlertMs: 60_000 }), true);
});

test('state scan tracker performs one full scan then keeps only changed and unresolved users', () => {
  const tracker = createTombstonedStateScanTracker();
  const firstRows = tracker.prepareRows([
    { user_id: 'user-a', state_json: '{}', updated_at: 10 },
    { user_id: 'user-b', state_json: '{}', updated_at: 20 },
  ]);
  assert.equal(firstRows.length, 2);
  assert.equal(tracker.getUpdatedAfter(), 0, 'cursor only commits after a successful reconciliation');

  tracker.commitPending(new Map([
    ['user-a', ['111111111111111111111111']],
  ]));
  assert.equal(tracker.getUpdatedAfter(), 20);
  const secondRows = tracker.prepareRows([
    { user_id: 'user-b', state_json: '{"shellDraft":{}}', updated_at: 30 },
  ]);
  assert.deepEqual(secondRows.map((row) => row.user_id).sort(), ['user-a', 'user-b']);
  assert.deepEqual(collectTombstonedInternalJobIds(secondRows.find((row) => row.user_id === 'user-a').state), [
    '111111111111111111111111',
  ]);
  assert.equal(tracker.getUpdatedAfter(), 20);

  tracker.commitPending(new Map());
  assert.equal(tracker.getUpdatedAfter(), 30);
  assert.deepEqual(tracker.prepareRows([]), []);

  tracker.commitPending(new Map());
  assert.deepEqual(tracker.prepareRows([
    { user_id: 'user-b', state_json: '{"shellDraft":{}}', updated_at: 30 },
  ]), [], 'the inclusive cursor skips an unchanged boundary row');
  assert.deepEqual(tracker.prepareRows([
    { user_id: 'user-b', state_json: '{"shellDraft":{"deletedJobIds":["222222222222222222222222"]}}', updated_at: 30 },
  ]).map((row) => row.user_id), ['user-b'], 'a same-millisecond state change is not missed');
});
