import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  claimDueAssetCleanupTasks,
  completeAssetCleanupTask,
  enqueueAssetCleanupTask,
  protectAssetCleanupTask,
  pruneAssetCleanupTasks,
  retryAssetCleanupTask,
  summarizeAssetCleanupStore,
  summarizeAssetCleanupTasks,
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

test('cleanup registry honors a deletion grace deadline before a task becomes claimable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    await enqueueAssetCleanupTask(null, taskInput({ nextAttemptAt: 5000 }), {
      registryPath,
      now: () => 1000,
    });
    assert.deepEqual(await claimDueAssetCleanupTasks(null, 10, { registryPath, now: () => 4999 }), []);
    assert.equal((await claimDueAssetCleanupTasks(null, 10, { registryPath, now: () => 5000 })).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('MySQL duplicate enqueue reopens protected or prematurely completed cleanup tasks', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql: String(sql), values });
      return String(sql).startsWith('SELECT') ? [[]] : [{ affectedRows: 1 }];
    },
  };

  await enqueueAssetCleanupTask(pool, taskInput(), { now: () => 1000 });
  const insertSql = calls[0].sql;
  assert.match(insertSql, /status IN \('protected', 'complete'\)/);
  assert.ok(
    insertSql.indexOf('updated_at = IF') < insertSql.indexOf("status = IF(status IN ('protected', 'complete')"),
    'reactivation checks must run before status is changed to pending',
  );
  assert.doesNotMatch(insertSql, /updated_at = VALUES\(updated_at\)/);
});

test('a completed local cleanup task can be reopened by reconciliation after a crash window', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const task = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    await completeAssetCleanupTask(null, task.id, { registryPath, now: () => 2000 });
    await enqueueAssetCleanupTask(null, taskInput({ reason: 'delete_pending_reconcile' }), {
      registryPath,
      now: () => 3000,
    });
    const stored = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(stored.tasks[0].status, 'pending');
    assert.equal(stored.tasks[0].completedAt, null);
    assert.equal(stored.tasks[0].reason, 'delete_pending_reconcile');
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

test('a cleanup task protected by a live reference can be reactivated by a later deletion request', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const task = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    await protectAssetCleanupTask(null, task.id, { registryPath, now: () => 2000 });
    let stored = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(stored.tasks[0].status, 'protected');

    const reactivated = await enqueueAssetCleanupTask(null, taskInput({ reason: 'later_owner_delete' }), {
      registryPath,
      now: () => 3000,
    });
    stored = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(reactivated.id, task.id);
    assert.equal(stored.tasks[0].status, 'pending');
    assert.equal(stored.tasks[0].reason, 'later_owner_delete');
    assert.equal(stored.tasks[0].nextAttemptAt, 3000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cleanup task summary exposes backlog age retries and manual review without object details', () => {
  const summary = summarizeAssetCleanupTasks([
    { status: 'pending', createdAt: 1000, attemptCount: 0 },
    { status: 'retry', createdAt: 2000, attemptCount: 2 },
    { status: 'manual_review', createdAt: 3000, attemptCount: 8 },
    { status: 'protected', createdAt: 4000, attemptCount: 0 },
    { status: 'complete', createdAt: 5000, attemptCount: 1 },
  ], 11_000);

  assert.deepEqual(summary, {
    backlog: 3,
    oldestPendingAgeMs: 10_000,
    retryAttempts: 10,
    manualReview: 1,
    protected: 1,
    complete: 1,
  });
  assert.equal(JSON.stringify(summary).includes('storageKey'), false);
});

test('MySQL cleanup health uses aggregate counters instead of loading object-level history', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(String(sql));
      return [[{
        backlog: 3,
        oldest_created_at: 1000,
        retry_attempts: 10,
        manual_review: 1,
        protected_count: 2,
        complete_count: 5,
      }]];
    },
  };

  const summary = await summarizeAssetCleanupStore(pool, { now: () => 11_000 });

  assert.deepEqual(summary, {
    backlog: 3,
    oldestPendingAgeMs: 10_000,
    retryAttempts: 10,
    manualReview: 1,
    protected: 2,
    complete: 5,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /SUM\(CASE WHEN status IN/);
  assert.doesNotMatch(calls[0], /SELECT \*/);
});

test('completed and protected cleanup audit rows are pruned after the retention window', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-asset-lifecycle-'));
  const registryPath = path.join(directory, 'cleanup.json');
  try {
    const completed = await enqueueAssetCleanupTask(null, taskInput(), { registryPath, now: () => 1000 });
    await completeAssetCleanupTask(null, completed.id, { registryPath, now: () => 2000 });
    const protectedTask = await enqueueAssetCleanupTask(null, taskInput({
      storageKey: 'managed-images/users/abc/source/asset-2/image.png',
      assetId: 'asset-2',
    }), { registryPath, now: () => 1500 });
    await protectAssetCleanupTask(null, protectedTask.id, { registryPath, now: () => 2500 });
    await enqueueAssetCleanupTask(null, taskInput({
      storageKey: 'managed-images/users/abc/source/asset-3/image.png',
      assetId: 'asset-3',
    }), { registryPath, now: () => 5000 });

    const result = await pruneAssetCleanupTasks(null, {
      registryPath,
      now: () => 10_000,
      retentionMs: 7000,
    });
    const stored = JSON.parse(await readFile(registryPath, 'utf8'));

    assert.equal(result.pruned, 2);
    assert.deepEqual(stored.tasks.map((task) => task.assetId), ['asset-3']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
