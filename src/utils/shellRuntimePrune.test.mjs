import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeShellRuntimeDeletionDrafts,
  pruneShellRuntimeSnapshotForDeletion,
} from './shellRuntimePrune.mjs';

test('prunes deleted local runtime projects before refresh can resurrect them', () => {
  const snapshot = {
    projects: [
      {
        id: 'job-905015350128b46238d1dcbe',
        backendJobId: '905015350128b46238d1dcbe',
        name: '策划方案 1',
        results: [],
      },
      {
        id: 'project-kept',
        name: '111',
        results: [{ id: 'result-kept', taskId: 'task-kept' }],
      },
      {
        id: 'project-with-deleted-result',
        name: '图片结果待同步',
        results: [{ id: 'deleted-result', taskId: 'deleted-job' }],
      },
    ],
    tasks: [
      { id: '905015350128b46238d1dcbe', projectId: 'job-905015350128b46238d1dcbe' },
      { id: 'task-kept', projectId: 'project-kept' },
    ],
    updatedAt: 123,
  };

  const pruned = pruneShellRuntimeSnapshotForDeletion(snapshot, {
    deletedJobIds: ['905015350128b46238d1dcbe', 'deleted-job'],
    deletedProjectIds: ['job-1b3a00b3104d24af6cd2f168'],
    deletedResultIds: ['deleted-result'],
  });

  assert.deepEqual(pruned.projects.map((project) => project.id), ['project-kept']);
  assert.deepEqual(pruned.tasks.map((task) => task.id), ['task-kept']);
  assert.equal(pruned.updatedAt, 123);
});

test('merges remote and local deletion tombstones for runtime pruning', () => {
  assert.deepEqual(
    mergeShellRuntimeDeletionDrafts(
      { deletedJobIds: ['job-a'], deletedProjectIds: ['project-a'], deletedResultIds: [] },
      { deletedJobIds: ['job-a', 'job-b'], deletedProjectIds: [], deletedResultIds: ['result-a'] },
    ),
    {
      deletedJobIds: ['job-a', 'job-b'],
      deletedProjectIds: ['project-a'],
      deletedResultIds: ['result-a'],
    },
  );
});

test('prunes pending runtime results by backend job tombstone', () => {
  const snapshot = {
    projects: [
      {
        id: 'project-with-pending-result',
        name: '待同步项目',
        results: [
          { id: 'task-img-pending-0', backendJobId: 'backend-job-a', status: 'generating' },
          { id: 'kept-result', backendJobId: 'backend-job-b', status: 'completed' },
        ],
      },
    ],
    tasks: [],
    updatedAt: 456,
  };

  const pruned = pruneShellRuntimeSnapshotForDeletion(snapshot, {
    deletedJobIds: ['backend-job-a'],
    deletedProjectIds: [],
    deletedResultIds: [],
  });

  assert.deepEqual(pruned.projects[0].results.map((result) => result.id), ['kept-result']);
  assert.equal(pruned.updatedAt, 456);
});
