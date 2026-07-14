import assert from 'node:assert/strict';
import test from 'node:test';

import { processAssetCleanupBatch, reconcileManagedAssetStorage } from './assetCleanupWorker.mjs';

const cleanupTask = (overrides = {}) => ({
  id: 'cleanup-1',
  assetId: 'asset-1',
  provider: 'tencent_cos',
  bucket: 'meiao-managed-images-1406860462',
  region: 'ap-guangzhou',
  storageKey: 'managed-images/users/abc/source/asset-1/image.png',
  action: 'delete',
  status: 'in_progress',
  attemptCount: 0,
  ...overrides,
});

test('cleanup worker completes a missing COS object as idempotent success', async () => {
  const completed = [];
  const assetStates = [];
  const summary = await processAssetCleanupBatch({
    pool: {},
    limit: 5,
    store: {
      claimDue: async () => [cleanupTask()],
      complete: async (_pool, taskId) => completed.push(taskId),
      retry: async () => { throw new Error('retry must not be called'); },
      markAssetStatus: async (_pool, assetId, status) => assetStates.push([assetId, status]),
    },
    deleteCos: async () => ({ deleted: true, missing: true }),
  });

  assert.deepEqual(summary, { claimed: 1, completed: 1, retried: 0, manualReview: 0, protected: 0 });
  assert.deepEqual(completed, ['cleanup-1']);
  assert.deepEqual(assetStates, [['asset-1', 'deleted']]);
});

test('cleanup worker persists a retry and continues the remaining batch', async () => {
  const retries = [];
  const completed = [];
  const summary = await processAssetCleanupBatch({
    pool: {},
    store: {
      claimDue: async () => [cleanupTask(), cleanupTask({
        id: 'cleanup-2',
        assetId: 'asset-2',
        storageKey: 'managed-images/users/abc/source/asset-2/image.png',
      })],
      complete: async (_pool, taskId) => completed.push(taskId),
      retry: async (_pool, taskId, error) => {
        retries.push([taskId, error.code]);
        return { status: 'retry' };
      },
      markAssetStatus: async () => {},
    },
    deleteCos: async (key) => {
      if (key.includes('asset-1')) throw Object.assign(new Error('temporary'), { code: 'ETIMEDOUT' });
      return { deleted: true, missing: false };
    },
  });

  assert.deepEqual(summary, { claimed: 2, completed: 1, retried: 1, manualReview: 0, protected: 0 });
  assert.deepEqual(retries, [['cleanup-1', 'ETIMEDOUT']]);
  assert.deepEqual(completed, ['cleanup-2']);
});

test('cleanup worker dispatches historical internal files without calling COS', async () => {
  const localDeletes = [];
  await processAssetCleanupBatch({
    pool: null,
    store: {
      claimDue: async () => [cleanupTask({
        provider: 'internal',
        bucket: '',
        region: '',
        storageKey: 'user/source/legacy.png',
      })],
      complete: async () => {},
      retry: async () => {},
      markAssetStatus: async () => {},
    },
    deleteCos: async () => { throw new Error('COS must not be called'); },
    deleteLocal: async (key) => localDeletes.push(key),
  });

  assert.deepEqual(localDeletes, ['user/source/legacy.png']);
});

test('cleanup worker restores a pending asset instead of deleting a newly live reference', async () => {
  const protectedTasks = [];
  const assetStates = [];
  let deleteCalls = 0;
  const summary = await processAssetCleanupBatch({
    pool: {},
    store: {
      claimDue: async () => [cleanupTask()],
      complete: async () => { throw new Error('protected cleanup must not complete as a physical delete'); },
      protect: async (_pool, taskId) => protectedTasks.push(taskId),
      retry: async () => { throw new Error('protected cleanup must not retry'); },
      markAssetStatus: async (_pool, assetId, status) => assetStates.push([assetId, status]),
    },
    isProtected: async () => true,
    deleteCos: async () => { deleteCalls += 1; },
  });

  assert.deepEqual(summary, { claimed: 1, completed: 0, retried: 0, manualReview: 0, protected: 1 });
  assert.equal(deleteCalls, 0);
  assert.deepEqual(assetStates, [['asset-1', 'active']]);
  assert.deepEqual(protectedTasks, ['cleanup-1']);
});

test('storage reconciliation repairs stale uploading and missing cleanup tasks', async () => {
  const enqueued = [];
  const states = [];
  const summary = await reconcileManagedAssetStorage({
    pool: {},
    env: {
      MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
      MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
      MEIAO_ASSET_UPLOAD_STALE_MS: '1000',
    },
    now: 5000,
    deps: {
      listAssets: async () => [
        cleanupTask({ id: 'active', storageStatus: 'active', createdAt: 1 }),
        cleanupTask({ id: 'pending', storageStatus: 'delete_pending', deletedAt: 4000 }),
        cleanupTask({ id: 'failed', storageStatus: 'upload_failed', createdAt: 3000 }),
        cleanupTask({ id: 'stale', storageStatus: 'uploading', createdAt: 1000 }),
      ],
      markStatus: async (_pool, assetId, status) => states.push([assetId, status]),
      enqueueCleanup: async (_pool, task) => enqueued.push(task),
    },
  });

  assert.deepEqual(summary, {
    scanned: 4,
    enqueued: 3,
    staleUploads: 1,
    uploadFailed: 2,
    deletePending: 1,
    uploading: 1,
  });
  assert.deepEqual(states, [['stale', 'upload_failed']]);
  assert.deepEqual(enqueued.map((task) => [task.assetId, task.reason]), [
    ['pending', 'delete_pending_reconcile'],
    ['failed', 'upload_failed_reconcile'],
    ['stale', 'stale_upload_reconcile'],
  ]);
});
