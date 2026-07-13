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
