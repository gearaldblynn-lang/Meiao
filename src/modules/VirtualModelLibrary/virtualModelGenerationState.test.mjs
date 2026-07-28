import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canFinalizeVirtualModelBatch,
  canRetryVirtualModelPose,
  deriveVirtualModelBatchProgress,
  mergeVirtualModelBatchPoll,
  shouldResumeVirtualModelBatch,
} from './virtualModelGenerationState.mjs';

const poseIds = ['C01', 'C02', 'C03', 'C04', 'C05', 'P05', 'P01', 'P03'];
const makeTasks = (status) => poseIds.map((poseId) => ({ poseId, status }));

test('finalize is enabled only when all eight unique poses match the current baseline revision', () => {
  const current = (status = 'succeeded') => ({
    baselineRevision: 2,
    derivedRegenerationRequired: false,
    poseTasks: makeTasks(status).map((task) => ['C01', 'P01'].includes(task.poseId)
      ? { ...task, referenceStatus: 'baseline_ready', managedReferenceAsset: { assetId: `managed-${task.poseId}` } }
      : { ...task, baselineRevision: 2 }),
  });
  assert.equal(canFinalizeVirtualModelBatch(current()), true);
  assert.equal(canFinalizeVirtualModelBatch({ ...current(), derivedRegenerationRequired: true }), false);
  assert.equal(canFinalizeVirtualModelBatch({ ...current(), poseTasks: current().poseTasks.slice(0, 7) }), false);
  assert.equal(canFinalizeVirtualModelBatch({
    ...current(),
    poseTasks: current().poseTasks.map((task) => task.poseId === 'C02'
      ? { ...task, baselineRevision: 1 }
      : task),
  }), false);
  assert.equal(canFinalizeVirtualModelBatch(current('persisting')), true);
  assert.equal(canFinalizeVirtualModelBatch(current('saved')), true);
  assert.equal(canFinalizeVirtualModelBatch({
    ...current(),
    poseTasks: current().poseTasks.map((task) => task.poseId === 'P01'
      ? { ...task, referenceStatus: 'generated', managedReferenceAsset: undefined }
      : task),
  }), false);
});

test('draft generation can retry failed cancelled and succeeded poses only', () => {
  assert.equal(canRetryVirtualModelPose({ status: 'failed' }), true);
  assert.equal(canRetryVirtualModelPose({ status: 'cancelled' }), true);
  assert.equal(canRetryVirtualModelPose({ status: 'succeeded' }), true);
  for (const status of ['pending', 'queued', 'running', 'retry_waiting', 'persisting', 'saved']) {
    assert.equal(canRetryVirtualModelPose({ status }), false);
  }
});

test('only unfinished persisted batches reopen from a draft', () => {
  for (const status of ['queued', 'running', 'retry_waiting', 'failed', 'cancelled', 'ready_to_finalize', 'persisting', 'regeneration_required']) {
    assert.equal(shouldResumeVirtualModelBatch({ status }), true);
  }
  assert.equal(shouldResumeVirtualModelBatch({ status: 'completed' }), false);
  assert.equal(shouldResumeVirtualModelBatch(null), false);
});

test('progress counts terminal results without changing layout size', () => {
  const tasks = makeTasks('pending').map((task, index) => ({
    ...task,
    status: index < 3 ? 'succeeded' : index === 3 ? 'failed' : 'pending',
    ...(task.poseId === 'C01' ? { referenceStatus: 'baseline_ready' } : {}),
  }));
  assert.deepEqual(
    deriveVirtualModelBatchProgress(tasks),
    { completed: 3, failed: 1, total: 8, percent: 38 },
  );
});

test('progress does not count an unstable baseline and reports reference failure', () => {
  const tasks = makeTasks('pending').map((task) => task.poseId === 'C01'
    ? { ...task, status: 'succeeded', referenceStatus: 'baseline_ready' }
    : task.poseId === 'P01'
      ? { ...task, status: 'succeeded', referenceStatus: 'reference_failed' }
      : task);
  assert.deepEqual(
    deriveVirtualModelBatchProgress(tasks),
    { completed: 1, failed: 1, total: 8, percent: 13 },
  );
});

test('poll merging ignores a different batch and responses older than the current state', () => {
  const current = {
    id: 'batch-1',
    status: 'running',
    poseTasks: makeTasks('running'),
    updatedAt: 20,
  };
  const newer = {
    id: 'batch-1',
    status: 'ready_to_finalize',
    poseTasks: makeTasks('succeeded'),
    updatedAt: 21,
  };
  assert.deepEqual(mergeVirtualModelBatchPoll(current, newer), newer);
  assert.deepEqual(
    mergeVirtualModelBatchPoll(current, { ...newer, id: 'other' }),
    current,
  );
  assert.deepEqual(
    mergeVirtualModelBatchPoll(current, { ...newer, updatedAt: 19 }),
    current,
  );
});
