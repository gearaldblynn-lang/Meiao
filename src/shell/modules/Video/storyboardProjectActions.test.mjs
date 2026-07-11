import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectActiveStoryboardBoardJobIds,
  collectStoryboardBoardJobIds,
  collectStoryboardProjectJobIds,
  markStoryboardProjectCancelled,
  removeStoryboardBoardResult,
} from './storyboardProjectActions.mjs';

const project = {
  id: 'storyboard-1',
  status: 'imaging',
  planningJobId: 'planning-job',
  backendJobId: 'latest-job',
  boards: [
    {
      id: 'board-1',
      status: 'completed',
      imageUrl: '/board-1.png',
      taskId: 'provider-1',
      backendJobId: 'board-job-1',
      imageVersions: [{ id: 'version-1', imageUrl: '/board-1.png' }],
    },
    {
      id: 'board-2',
      status: 'generating',
      backendJobId: 'board-job-2',
    },
  ],
};

test('storyboard project cancellation collects every durable backend job id', () => {
  assert.deepEqual(
    collectStoryboardProjectJobIds(project),
    ['planning-job', 'latest-job', 'board-job-1', 'board-job-2'],
  );
});

test('storyboard project deletion includes superseded job ids from shell tasks and results', () => {
  const ids = collectStoryboardProjectJobIds({
    id: 'project-1',
    planningJobId: 'planning-job',
    boards: [{ id: 'board-1', backendJobId: 'new-board-job' }],
  }, {
    tasks: [
      { projectId: 'project-1', backendJobId: 'old-board-job' },
      { projectId: 'other-project', backendJobId: 'unrelated-job' },
    ],
    shellProject: {
      id: 'project-1',
      results: [{ backendJobId: 'older-board-job' }],
    },
  });

  assert.deepEqual(ids, ['planning-job', 'new-board-job', 'old-board-job', 'older-board-job']);
});

test('single storyboard result deletion cancels every job known for that board only', () => {
  const ids = collectStoryboardBoardJobIds({
    id: 'project-1',
    boards: [
      { id: 'board-1', backendJobId: 'new-board-job' },
      { id: 'board-2', backendJobId: 'other-board-job' },
    ],
  }, 'board-1', {
    tasks: [
      { projectId: 'project-1', storyboardBoardId: 'board-1', backendJobId: 'old-board-job' },
      { projectId: 'project-1', storyboardBoardId: 'board-2', backendJobId: 'unrelated-job' },
    ],
    jobs: [
      {
        id: 'old-completed-board-job',
        module: 'video',
        payload: {
          shellProjectId: 'project-1',
          planningPurpose: 'storyboard_board_image',
          boardId: 'board-1',
        },
      },
      {
        id: 'other-completed-board-job',
        module: 'video',
        payload: {
          shellProjectId: 'project-1',
          planningPurpose: 'storyboard_board_image',
          boardId: 'board-2',
        },
      },
    ],
    shellProject: {
      results: [
        { id: 'board-1', backendJobId: 'older-board-job' },
        { id: 'board-2', backendJobId: 'other-result-job' },
      ],
    },
  });

  assert.deepEqual(ids, ['new-board-job', 'old-board-job', 'old-completed-board-job', 'older-board-job']);
});

test('single storyboard result deletion waits only for active jobs and guarded late submissions', () => {
  const ids = collectActiveStoryboardBoardJobIds({
    id: 'project-1',
    boards: [{ id: 'board-1', status: 'generating', backendJobId: 'current-active-job' }],
  }, 'board-1', {
    tasks: [
      { projectId: 'project-1', storyboardBoardId: 'board-1', status: 'retry_waiting', id: 'active-task-job' },
      { projectId: 'project-1', storyboardBoardId: 'board-1', status: 'completed', id: 'terminal-task-job' },
    ],
    jobs: [
      {
        id: 'historical-active-job',
        module: 'video',
        status: 'running',
        payload: {
          shellProjectId: 'project-1',
          planningPurpose: 'storyboard_board_image',
          boardId: 'board-1',
        },
      },
      {
        id: 'historical-terminal-job',
        module: 'video',
        status: 'succeeded',
        payload: {
          shellProjectId: 'project-1',
          planningPurpose: 'storyboard_board_image',
          boardId: 'board-1',
        },
      },
    ],
    guardedJobIds: ['late-created-job'],
  });

  assert.deepEqual(ids, [
    'current-active-job',
    'active-task-job',
    'historical-active-job',
    'late-created-job',
  ]);
});

test('storyboard cancellation stops active boards without erasing completed results', () => {
  const cancelled = markStoryboardProjectCancelled(project);

  assert.equal(cancelled.status, 'failed');
  assert.match(cancelled.error, /中断|取消/);
  assert.equal(cancelled.boards[0].status, 'completed');
  assert.equal(cancelled.boards[0].imageUrl, '/board-1.png');
  assert.equal(cancelled.boards[1].status, 'failed');
  assert.match(cancelled.boards[1].error, /中断|取消/);
});

test('deleting one storyboard result updates the durable board source', () => {
  const updated = removeStoryboardBoardResult(project, 'board-1');
  const board = updated.boards[0];

  assert.equal(updated.status, 'imaging');
  assert.equal(board.status, 'pending');
  assert.equal(board.imageUrl, undefined);
  assert.equal(board.taskId, undefined);
  assert.equal(board.backendJobId, undefined);
  assert.equal(board.autoResumeBlocked, true);
  assert.deepEqual(board.imageVersions, []);
  assert.equal(updated.boards[1], project.boards[1]);
});

test('deleting the latest storyboard result moves project identity to a remaining board job', () => {
  const updated = removeStoryboardBoardResult({
    ...project,
    backendJobId: 'board-job-2',
  }, 'board-2');

  assert.equal(updated.backendJobId, 'board-job-1');
  assert.equal(updated.boards[1].backendJobId, undefined);
});
