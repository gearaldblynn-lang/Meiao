import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  claimDueAssetCleanupTasks,
  completeAssetCleanupTask,
  enqueueAssetCleanupTask,
  retryAssetCleanupTask,
} from './assetLifecycleStore.mjs';

const taskInput = (overrides = {}) => ({
  assetId: 'asset-1',
  provider: 'tencent_cos',
  bucket: 'meiao-managed-images-1406860462',
  region: 'ap-guangzhou',
  storageKey: 'managed-images/users/abc/source/asset-1/image.png',
  action: 'delete',
  reason: 'account_deleted',
  ...overrides,
});

test('local cleanup registry deduplicates the exact provider bucket key and action', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const first = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    const duplicate = await enqueueAssetCleanupTask(null, taskInput({ reason: 'project_deleted' }), {
      registryPath,
      now: () => 2000,
    });
    const stored = JSON.parse(await readFile(registryPath, 'utf8'));

    assert.equal(first.id, duplicate.id);
    assert.equal(stored.tasks.length, 1);
    assert.equal(stored.tasks[0].bucket, 'meiao-managed-images-1406860462');
    assert.equal(stored.tasks[0].region, 'ap-guangzhou');
    assert.equal(stored.tasks[0].storageKey, 'managed-images/users/abc/source/asset-1/image.png');
    assert.equal(stored.tasks[0].userId, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('local cleanup task survives claim retry and process-style reload', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const task = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    const claimed = await claimDueAssetCleanupTasks(null, 10, { registryPath, now: () => 1000 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].status, 'in_progress');

    await retryAssetCleanupTask(null, task.id, new Error('temporary COS failure'), {
      registryPath,
      now: () => 1100,
      retryBaseMs: 100,
      maxAttemptsBeforeManualReview: 3,
    });
    assert.deepEqual(await claimDueAssetCleanupTasks(null, 10, { registryPath, now: () => 1199 }), []);

    const afterReload = await claimDueAssetCleanupTasks(null, 10, { registryPath, now: () => 1200 });
    assert.equal(afterReload.length, 1);
    assert.equal(afterReload[0].attemptCount, 1);
    assert.equal(afterReload[0].lastError, 'temporary COS failure');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cleanup retry enters manual review without deleting the durable task', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const task = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    await retryAssetCleanupTask(null, task.id, new Error('secret=q-signature-sensitive'), {
      registryPath,
      now: () => 2000,
      retryBaseMs: 100,
      maxAttemptsBeforeManualReview: 1,
    });
    const stored = JSON.parse(await readFile(registryPath, 'utf8'));

    assert.equal(stored.tasks.length, 1);
    assert.equal(stored.tasks[0].status, 'manual_review');
    assert.equal(stored.tasks[0].attemptCount, 1);
    assert.equal(stored.tasks[0].lastError, 'managed_asset_cleanup_failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('complete cleanup task keeps bounded audit metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const task = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    await completeAssetCleanupTask(null, task.id, { registryPath, now: () => 3000 });
    const stored = JSON.parse(await readFile(registryPath, 'utf8'));

    assert.equal(stored.tasks[0].status, 'complete');
    assert.equal(stored.tasks[0].completedAt, 3000);
    assert.equal(stored.tasks[0].lastError, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
