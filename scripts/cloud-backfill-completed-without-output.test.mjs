import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillState } from './cloud-backfill-completed-without-output.mjs';

const makeState = () => ({
  shellProjects: [{
    id: 'proj-plan-1',
    module: 'one_click',
    status: 'completed',
    taskCount: 1,
    completedCount: 1,
    results: [{ id: 'r1', status: 'completed', backendJobId: 'job-aaa', imageUrl: '' }],
  }],
  oneClickMemory: {
    firstImage: {
      projects: [{ id: 'proj-plan-1', status: 'completed', taskCount: 1, completedCount: 1, results: [] }],
    },
  },
});

test('backfillState writes job imageUrl back into URL-less completed results and syncs mirrors', () => {
  const state = makeState();
  const actions = backfillState(state, new Map([
    ['job-aaa', { imageUrl: 'http://cdn/img.png', imageUrlAssetId: 'asset-1' }],
  ]));

  const types = actions.map((action) => action.type);
  assert.ok(types.includes('backfill_result_image_url'));
  assert.ok(types.includes('sync_mirror_results_from_shell'));
  assert.equal(state.shellProjects[0].results[0].imageUrl, 'http://cdn/img.png');
  assert.equal(state.shellProjects[0].results[0].imageUrlAssetId, 'asset-1');
  assert.equal(state.shellProjects[0].taskCount, 1);
  assert.equal(state.shellProjects[0].completedCount, 1);
  assert.equal(state.oneClickMemory.firstImage.projects[0].results[0].imageUrl, 'http://cdn/img.png');
});

test('backfillState normalizes counts when they drifted from output count', () => {
  const state = {
    shellProjects: [{
      id: 'job-bbb-card',
      module: 'translation',
      status: 'completed',
      taskCount: 1,
      completedCount: 0,
      results: [{ id: 'r1', status: 'completed', backendJobId: 'job-bbb' }],
    }],
  };
  const actions = backfillState(state, new Map([['job-bbb', { imageUrl: 'http://cdn/t.png' }]]));

  assert.ok(actions.some((action) => action.type === 'normalize_counts_after_backfill'));
  assert.equal(state.shellProjects[0].completedCount, 1);
});

test('backfillState leaves untouched when job has no image result', () => {
  const state = makeState();
  const actions = backfillState(state, new Map());

  assert.equal(actions.length, 0);
  assert.equal(state.shellProjects[0].results[0].imageUrl, '');
});

test('backfillState skips projects that already have output', () => {
  const state = {
    shellProjects: [{
      id: 'proj-ok',
      status: 'completed',
      taskCount: 1,
      completedCount: 1,
      results: [{ id: 'r1', status: 'completed', imageUrl: '/already.png', backendJobId: 'job-ccc' }],
    }],
  };
  const actions = backfillState(state, new Map([['job-ccc', { imageUrl: 'http://cdn/other.png' }]]));

  assert.equal(actions.length, 0);
  assert.equal(state.shellProjects[0].results[0].imageUrl, '/already.png');
});
