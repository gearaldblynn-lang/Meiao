import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectTombstonedInternalJobIds,
  reconcileTombstonedJobs,
} from './tombstonedJobReconciler.mjs';

const terminalJobId = '111111111111111111111111';
const queuedJobId = '222222222222222222222222';
const runningJobId = '333333333333333333333333';

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
    pending: 1,
    errors: 0,
  });
});
