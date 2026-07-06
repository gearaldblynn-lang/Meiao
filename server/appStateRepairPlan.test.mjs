import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAppStateRepairPlan } from './appStateRepairPlan.mjs';

test('buildAppStateRepairPlan prunes unrecoverable active placeholders when output exists', () => {
  const state = {
    shellProjects: [{
      id: 'project-a',
      status: 'completed',
      taskCount: 2,
      completedCount: 1,
      results: [
        { id: 'result-a', status: 'completed', imageUrl: '/a.png', taskId: 'provider-a' },
        { id: 'placeholder-a', status: 'generating', imageUrl: '' },
      ],
    }],
  };

  const plan = buildAppStateRepairPlan(state);

  assert.equal(plan.changed, true);
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].type, 'prune_active_result_without_identity');
  assert.equal(plan.actions[1].type, 'normalize_completed_project_counts');
  assert.deepEqual(plan.nextState.shellProjects[0].results.map((result) => result.id), ['result-a']);
  assert.equal(plan.nextState.shellProjects[0].status, 'completed');
  assert.equal(plan.nextState.shellProjects[0].taskCount, 1);
  assert.equal(plan.nextState.shellProjects[0].completedCount, 1);
  assert.equal(plan.before.issueCounts.active_result_without_identity, 1);
  assert.equal(plan.after.issueCounts.active_result_without_identity || 0, 0);
});

test('buildAppStateRepairPlan marks active placeholders failed when no output exists', () => {
  const plan = buildAppStateRepairPlan({
    oneClickMemory: {
      sku: {
        projects: [{
          id: 'project-a',
          status: 'generating',
          schemes: [{ id: 'scheme-a', status: 'generating', resultUrl: '' }],
        }],
      },
    },
  });

  const scheme = plan.nextState.oneClickMemory.sku.projects[0].schemes[0];
  assert.equal(plan.changed, true);
  assert.equal(plan.actions[0].type, 'mark_active_result_without_identity_failed');
  assert.equal(scheme.status, 'error');
  assert.match(scheme.error, /缺少云端任务身份/);
  assert.equal(plan.after.issueCounts.active_result_without_identity || 0, 0);
});

test('buildAppStateRepairPlan downgrades completed projects without output', () => {
  const plan = buildAppStateRepairPlan({
    buyerShowMemory: {
      sets: [{
        id: 'set-a',
        status: 'completed',
        taskCount: 1,
        completedCount: 0,
        results: [],
      }],
    },
  });

  const set = plan.nextState.buyerShowMemory.sets[0];
  assert.equal(plan.changed, true);
  assert.equal(plan.actions[0].type, 'mark_completed_project_without_output_error');
  assert.equal(set.status, 'error');
  assert.equal(set.completedCount, 0);
  assert.match(set.error, /没有可展示结果/);
  assert.equal(plan.after.issueCounts.completed_project_without_output || 0, 0);
});

test('buildAppStateRepairPlan leaves storyboard planning-completed projects untouched', () => {
  const plan = buildAppStateRepairPlan({
    videoMemory: {
      storyboard: {
        projects: [{
          id: 'video_1779442347056_0_cuz4',
          status: 'completed',
          script: '分镜1(1.6秒)画面:暗色调的宠物窝特写。',
          shots: [{ id: 'shot-1' }],
          boards: [{ id: 'board-1', scriptText: '...', imageUrl: '' }],
          taskCount: 1,
          completedCount: 0,
        }],
      },
    },
  });

  const project = plan.nextState.videoMemory.storyboard.projects[0];
  assert.equal(plan.changed, false);
  assert.equal(project.status, 'completed');
  assert.equal(project.completedCount, 0);
});

test('buildAppStateRepairPlan still downgrades a truly empty storyboard project', () => {
  const plan = buildAppStateRepairPlan({
    videoMemory: {
      storyboard: {
        projects: [{ id: 'video_empty', status: 'completed', script: '', shots: [], boards: [] }],
      },
    },
  });

  assert.equal(plan.changed, true);
  assert.equal(plan.actions[0].type, 'mark_completed_project_without_output_error');
  assert.equal(plan.nextState.videoMemory.storyboard.projects[0].status, 'error');
});

test('buildAppStateRepairPlan keeps source state immutable', () => {
  const state = {
    shellProjects: [{
      id: 'project-a',
      status: 'completed',
      taskCount: 2,
      completedCount: 1,
      results: [
        { id: 'result-a', status: 'completed', imageUrl: '/a.png', taskId: 'provider-a' },
        { id: 'placeholder-a', status: 'generating', imageUrl: '' },
      ],
    }],
  };

  const before = JSON.stringify(state);
  buildAppStateRepairPlan(state);

  assert.equal(JSON.stringify(state), before);
});
