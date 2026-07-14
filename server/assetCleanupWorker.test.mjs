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
  const lifecycle = [];
  const summary = await processAssetCleanupBatch({
    pool: {},
    limit: 5,
    store: {
      claimDue: async () => [cleanupTask()],
      complete: async (_pool, taskId) => {
        completed.push(taskId);
        lifecycle.push(['complete', taskId]);
      },
      retry: async () => { throw new Error('retry must not be called'); },
      markAssetStatus: async (_pool, assetId, status) => {
        assetStates.push([assetId, status]);
        lifecycle.push(['asset', assetId, status]);
      },
    },
    deleteCos: async () => ({ deleted: true, missing: true }),
  });

  assert.deepEqual(summary, { claimed: 1, completed: 1, retried: 0, manualReview: 0, protected: 0 });
  assert.deepEqual(completed, ['cleanup-1']);
  assert.deepEqual(assetStates, [['asset-1', 'deleted']]);
  assert.deepEqual(lifecycle, [
    ['asset', 'asset-1', 'deleted'],
    ['complete', 'cleanup-1'],
  ]);
});

test('cleanup worker retries the durable task if marking the asset deleted fails after physical delete', async () => {
  const retries = [];
  let completeCalls = 0;
  const summary = await processAssetCleanupBatch({
    pool: {},
    store: {
      claimDue: async () => [cleanupTask()],
      complete: async () => { completeCalls += 1; },
      retry: async (_pool, taskId, error) => {
        retries.push([taskId, error.message]);
        return { status: 'retry' };
      },
      markAssetStatus: async () => { throw new Error('database interrupted'); },
    },
    deleteCos: async () => ({ deleted: true, missing: false }),
  });

  assert.equal(completeCalls, 0);
  assert.deepEqual(retries, [['cleanup-1', 'database interrupted']]);
  assert.equal(summary.retried, 1);
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

test('cleanup worker never resurrects an active row whose COS object is confirmed missing', async () => {
  const completed = [];
  const protectedTasks = [];
  const assetStates = [];
  let deleteCalls = 0;
  const summary = await processAssetCleanupBatch({
    pool: {},
    store: {
      claimDue: async () => [cleanupTask({ reason: 'active_object_missing_reconcile' })],
      complete: async (_pool, taskId) => completed.push(taskId),
      protect: async (_pool, taskId) => protectedTasks.push(taskId),
      retry: async () => { throw new Error('missing-object cleanup must not retry'); },
      markAssetStatus: async (_pool, assetId, status) => assetStates.push([assetId, status]),
    },
    isProtected: async () => true,
    deleteCos: async () => {
      deleteCalls += 1;
      return { deleted: true, missing: true };
    },
  });

  assert.deepEqual(summary, { claimed: 1, completed: 1, retried: 0, manualReview: 0, protected: 0 });
  assert.equal(deleteCalls, 1);
  assert.deepEqual(assetStates, [['asset-1', 'deleted']]);
  assert.deepEqual(completed, ['cleanup-1']);
  assert.deepEqual(protectedTasks, []);
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
        cleanupTask({ id: 'pending', storageStatus: 'delete_pending', deletedAt: 4000, storageBucket: 'snapshot-bucket', storageRegion: 'snapshot-region' }),
        cleanupTask({ id: 'failed', storageStatus: 'upload_failed', createdAt: 3000, storageBucket: 'snapshot-bucket', storageRegion: 'snapshot-region' }),
        cleanupTask({ id: 'stale', storageStatus: 'uploading', createdAt: 1000, storageBucket: 'snapshot-bucket', storageRegion: 'snapshot-region' }),
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
    snapshotMissing: 0,
    activeCosChecked: 0,
    activeCosMissing: 0,
    activeCosHeadFailed: 0,
  });
  assert.deepEqual(states, [['stale', 'upload_failed']]);
  assert.deepEqual(enqueued.map((task) => [task.assetId, task.reason]), [
    ['pending', 'delete_pending_reconcile'],
    ['failed', 'upload_failed_reconcile'],
    ['stale', 'stale_upload_reconcile'],
  ]);
  assert.ok(enqueued.every((task) => task.bucket === 'snapshot-bucket' && task.region === 'snapshot-region'));
});

test('storage reconciliation quarantines a missing COS snapshot and continues unrelated assets', async () => {
  const enqueued = [];
  const summary = await reconcileManagedAssetStorage({
    pool: {},
    env: {
      MEIAO_IMAGE_COS_BUCKET: 'current-but-unsafe-bucket',
      MEIAO_IMAGE_COS_REGION: 'current-region',
    },
    deps: {
      listAssets: async () => [
        cleanupTask({
          id: 'legacy-pending',
          storageStatus: 'delete_pending',
          storageBucket: '',
          storageRegion: '',
        }),
        cleanupTask({
          id: 'safe-pending',
          storageStatus: 'delete_pending',
          storageBucket: 'snapshot-bucket',
          storageRegion: 'snapshot-region',
        }),
      ],
      enqueueCleanup: async (_pool, task) => enqueued.push(task),
    },
  });

  assert.equal(summary.snapshotMissing, 1);
  assert.equal(summary.enqueued, 1);
  assert.deepEqual(enqueued.map((task) => task.assetId), ['safe-pending']);
  assert.equal(enqueued[0].bucket, 'snapshot-bucket');
});

test('daily reconciliation turns an active row with a missing COS object into a durable consistency cleanup', async () => {
  const enqueued = [];
  const states = [];
  const headCalls = [];
  const summary = await reconcileManagedAssetStorage({
    pool: {},
    now: 50_000,
    verifyActiveCos: true,
    deps: {
      listAssets: async () => [
        cleanupTask({ id: 'present', storageStatus: 'active', storageBucket: 'bucket-a', storageRegion: 'region-a' }),
        cleanupTask({ id: 'missing', storageStatus: 'active', storageKey: 'managed-images/missing.png', storageBucket: 'bucket-b', storageRegion: 'region-b' }),
      ],
      headCos: async (key, env) => {
        headCalls.push([key, env.MEIAO_IMAGE_COS_BUCKET, env.MEIAO_IMAGE_COS_REGION]);
        return { exists: key !== 'managed-images/missing.png' };
      },
      markStatus: async (_pool, assetId, status) => states.push([assetId, status]),
      enqueueCleanup: async (_pool, task) => enqueued.push(task),
    },
  });

  assert.equal(summary.activeCosChecked, 2);
  assert.equal(summary.activeCosMissing, 1);
  assert.equal(summary.activeCosHeadFailed, 0);
  assert.deepEqual(states, [['missing', 'delete_pending']]);
  assert.deepEqual(enqueued.map((task) => [task.assetId, task.reason]), [
    ['missing', 'active_object_missing_reconcile'],
  ]);
  assert.deepEqual(headCalls, [
    [cleanupTask().storageKey, 'bucket-a', 'region-a'],
    ['managed-images/missing.png', 'bucket-b', 'region-b'],
  ]);
});
