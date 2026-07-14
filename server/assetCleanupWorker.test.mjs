import assert from 'node:assert/strict';
import test from 'node:test';

import { processAssetCleanupBatch } from './assetCleanupWorker.mjs';

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

  assert.deepEqual(summary, { claimed: 1, completed: 1, retried: 0, manualReview: 0 });
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

  assert.deepEqual(summary, { claimed: 2, completed: 1, retried: 1, manualReview: 0 });
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
