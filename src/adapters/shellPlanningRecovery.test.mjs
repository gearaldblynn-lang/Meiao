import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFailedPlanningResult,
  hasConcretePlanningRecoveryResult,
  isStalePlanningFailureResult,
} from './shellPlanningRecovery.ts';

test('isStalePlanningFailureResult recognizes no-identity planning failure placeholders', () => {
  assert.equal(isStalePlanningFailureResult({
    status: 'error',
    imageUrl: '',
    prompt: '策划失败：任务已提交云端，结果待同步',
  }), true);
});

test('isStalePlanningFailureResult does not treat identified backend failures as stale placeholders', () => {
  assert.equal(isStalePlanningFailureResult({
    status: 'error',
    backendJobId: 'backend-job-1',
    prompt: '策划失败：未返回可用方案',
  }), false);
  assert.equal(isStalePlanningFailureResult({
    status: 'error',
    taskId: 'provider-task-1',
    prompt: '策划失败：未返回可用方案',
  }), false);
});

test('hasConcretePlanningRecoveryResult accepts completed media and active provider-backed generation', () => {
  assert.equal(hasConcretePlanningRecoveryResult({
    status: 'completed',
    imageUrl: '/done.png',
  }), true);
  assert.equal(hasConcretePlanningRecoveryResult({
    status: 'generating',
    taskId: 'provider-task-1',
  }), true);
});

test('hasConcretePlanningRecoveryResult accepts real errors but ignores stale planning placeholders', () => {
  assert.equal(hasConcretePlanningRecoveryResult({
    status: 'error',
    backendJobId: 'failed-job-1',
    prompt: 'Internal Error, Please try again later.',
  }), true);
  assert.equal(hasConcretePlanningRecoveryResult({
    status: 'error',
    prompt: '策划失败：结果待同步',
  }), false);
});

test('buildFailedPlanningResult preserves job, provider, plan, and error diagnostics', () => {
  const result = buildFailedPlanningResult({
    jobId: 'planning-job-1',
    projectId: 'project-1',
    payloadPlanId: 'payload-plan-1',
    failedPlanId: 'planning-job-1-error',
    selectedPlanId: 'selected-plan-1',
    errorMessage: '策划返回未解析出可用方案',
    fallbackPrompt: '一键主详策划',
    model: 'gemini-3-flash',
    aspectRatio: 'auto',
    createdAt: 1781510000000,
    module: 'one_click',
    subFeature: 'first_image',
    providerTaskId: 'provider-task-1',
    creditsConsumed: 3,
  });

  assert.deepEqual(result, {
    id: 'planning-job-1-error',
    planId: 'payload-plan-1',
    projectId: 'project-1',
    imageUrl: '',
    prompt: '策划返回未解析出可用方案',
    model: 'gemini-3-flash',
    aspectRatio: 'auto',
    status: 'error',
    createdAt: 1781510000000,
    module: 'one_click',
    subFeature: 'first_image',
    taskId: 'provider-task-1',
    backendJobId: 'planning-job-1',
    creditsConsumed: 3,
    error: '策划返回未解析出可用方案',
  });
});
