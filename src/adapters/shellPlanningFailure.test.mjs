import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFailedOneClickPlanningPlan,
  collectFailedOneClickPlanningPlans,
  getPlanningReferenceIndex,
} from './shellPlanningFailure.ts';

const baseJob = (overrides = {}) => ({
  id: 'job-1',
  module: 'one_click',
  taskType: 'kie_chat',
  status: 'failed',
  provider: 'kie',
  payload: {
    shellProjectId: 'project-1',
    shellProjectName: '6月8日项目6',
    shellPlanningPurpose: 'one_click_planning',
    shellReferenceUrl: '/ref-1.jpg',
    shellReferenceIndex: 1,
  },
  errorMessage: '任务提交上游前长时间未返回上游任务 ID，已自动失败并释放并发',
  ...overrides,
});

test('getPlanningReferenceIndex normalizes valid positive reference indexes', () => {
  assert.equal(getPlanningReferenceIndex(baseJob()), 1);
  assert.equal(getPlanningReferenceIndex(baseJob({ payload: { shellReferenceIndex: '5' } })), 5);
  assert.equal(getPlanningReferenceIndex(baseJob({ payload: { shellReferenceIndex: 0 } })), 0);
  assert.equal(getPlanningReferenceIndex(baseJob({ payload: { shellReferenceIndex: 'bad' } })), 0);
});

test('buildFailedOneClickPlanningPlan preserves failure as a visible planning card', () => {
  const plan = buildFailedOneClickPlanningPlan(baseJob(), '6月8日项目6', '策划失败');

  assert.equal(plan.id, 'job-1-error');
  assert.equal(plan.title, '6月8日项目6 1');
  assert.equal(plan.status, 'error');
  assert.equal(plan.selected, false);
  assert.equal(plan.planningFailed, true);
  assert.equal(plan.sourceReferenceUrl, '/ref-1.jpg');
  assert.equal(plan.schemeContent, '策划失败');
});

test('collectFailedOneClickPlanningPlans returns every failed planning child for the project', () => {
  const jobs = [5, 3, 1, 4, 2].map((index) => baseJob({
    id: `job-${index}`,
    payload: {
      shellProjectId: 'project-1',
      shellProjectName: '6月8日项目6',
      shellPlanningPurpose: 'one_click_planning',
      shellReferenceUrl: `/ref-${index}.jpg`,
      shellReferenceIndex: index,
    },
  }));
  jobs.push(baseJob({
    id: 'other-project-job',
    payload: {
      shellProjectId: 'project-2',
      shellPlanningPurpose: 'one_click_planning',
      shellReferenceIndex: 1,
    },
  }));
  jobs.push(baseJob({
    id: 'succeeded-job',
    status: 'succeeded',
    payload: {
      shellProjectId: 'project-1',
      shellPlanningPurpose: 'one_click_planning',
      shellReferenceIndex: 6,
    },
  }));

  const plans = collectFailedOneClickPlanningPlans(jobs, {
    projectId: 'project-1',
    projectName: '6月8日项目6',
    fallbackErrorMessage: '策划失败',
  });

  assert.deepEqual(plans.map((plan) => plan.id), [
    'job-1-error',
    'job-2-error',
    'job-3-error',
    'job-4-error',
    'job-5-error',
  ]);
  assert.equal(plans.length, 5);
  assert.deepEqual(plans.map((plan) => plan.sourceReferenceUrl), [
    '/ref-1.jpg',
    '/ref-2.jpg',
    '/ref-3.jpg',
    '/ref-4.jpg',
    '/ref-5.jpg',
  ]);
});
