import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDeletionOutcome,
  startDeletionOperations,
} from './deletionOperations.ts';

const fulfilled = (value = undefined) => ({ status: 'fulfilled', value });
const rejected = (reason = new Error('delete failed')) => ({ status: 'rejected', reason });

test('deletion operations start tombstone persistence without waiting for physical deletion', async () => {
  const events = [];
  let finishPhysicalDeletion;
  const physicalDeletion = new Promise((resolve) => { finishPhysicalDeletion = resolve; });

  const pending = startDeletionOperations({
    jobIds: ['backend-job-1'],
    deleteJob: async () => {
      events.push('physical-started');
      await physicalDeletion;
    },
    persistTombstone: async () => {
      events.push('tombstone-started');
      return true;
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, ['physical-started', 'tombstone-started']);
  finishPhysicalDeletion();
  await pending;
});

test('deletion operations treat already absent jobs as idempotent success', async () => {
  const [results] = await startDeletionOperations({
    jobIds: ['backend-job-missing'],
    deleteJob: async () => { throw Object.assign(new Error('任务不存在。'), { status: 404, code: 'job_not_found' }); },
    persistTombstone: async () => true,
  });

  assert.equal(results[0].status, 'fulfilled');
  assert.deepEqual(results[0].value, { deletionStatus: 'already_absent' });
});

test('deletion operations report active remote jobs as scheduled cleanup instead of failure', async () => {
  const [results] = await startDeletionOperations({
    jobIds: ['backend-job-running'],
    deleteJob: async () => { throw Object.assign(new Error('任务仍在运行'), { status: 409, code: 'job_delete_active' }); },
    persistTombstone: async () => true,
  });

  assert.equal(results[0].status, 'fulfilled');
  assert.deepEqual(results[0].value, { deletionStatus: 'scheduled' });
  assert.deepEqual(resolveDeletionOutcome({
    scope: 'project',
    tombstoneSynced: true,
    deletionResults: results,
    hasPhysicalTargets: true,
  }), {
    message: '历史任务已隐藏，远端任务正在清理',
    tone: 'info',
  });
});

test('single-result deletion outcome reports tombstone and physical deletion matrix accurately', () => {
  const cases = [
    {
      name: 'both succeed',
      tombstoneSynced: true,
      deletionResults: [fulfilled()],
      expected: { message: '历史任务已删除', tone: 'info' },
    },
    {
      name: 'tombstone succeeds and physical deletion is partial',
      tombstoneSynced: true,
      deletionResults: [fulfilled(), rejected()],
      expected: { message: '历史任务已隐藏，远端任务删除未完全成功', tone: 'warning' },
    },
    {
      name: 'tombstone fails after physical deletion succeeds',
      tombstoneSynced: false,
      deletionResults: [fulfilled()],
      expected: { message: '已删除当前任务，但远端历史同步失败', tone: 'warning' },
    },
    {
      name: 'both fail',
      tombstoneSynced: false,
      deletionResults: [rejected()],
      expected: { message: '远端历史同步和任务删除均未完全成功', tone: 'warning' },
    },
  ];

  for (const item of cases) {
    assert.deepEqual(resolveDeletionOutcome({
      scope: 'result',
      tombstoneSynced: item.tombstoneSynced,
      deletionResults: item.deletionResults,
      hasPhysicalTargets: true,
    }), item.expected, item.name);
  }
});

test('project deletion outcome uses the same combined failure resolver', () => {
  assert.deepEqual(resolveDeletionOutcome({
    scope: 'project',
    tombstoneSynced: false,
    deletionResults: [rejected()],
    hasPhysicalTargets: true,
  }), {
    message: '远端历史同步和任务删除均未完全成功',
    tone: 'warning',
  });
});

test('successful tombstone without a physical target reports hidden instead of deleted', () => {
  assert.deepEqual(resolveDeletionOutcome({
    scope: 'result',
    tombstoneSynced: true,
    deletionResults: [],
    hasPhysicalTargets: false,
  }), {
    message: '历史任务已隐藏',
    tone: 'info',
  });
});
