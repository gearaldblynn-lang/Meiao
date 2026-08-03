import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getVisibleProviderTaskId,
  isBuyerShowPlanningControlJob,
  isProviderMediaJob,
  isShellControlJob,
  shouldExposeActiveJobResult,
} from './shellJobVisibility.ts';

test('isProviderMediaJob only treats KIE media-like tasks as provider media jobs', () => {
  assert.equal(isProviderMediaJob({ provider: 'kie', taskType: 'kie_image' }), true);
  assert.equal(isProviderMediaJob({ provider: 'kie', taskType: 'seedance_video' }), true);
  assert.equal(isProviderMediaJob({ provider: 'kie', taskType: 'openai_responses' }), false);
  assert.equal(isProviderMediaJob({ provider: 'openai', taskType: 'kie_image' }), false);
});

test('getVisibleProviderTaskId prefers direct providerTaskId and falls back to result providerTaskId', () => {
  assert.equal(getVisibleProviderTaskId({ providerTaskId: 'direct-id', result: { providerTaskId: 'result-id' } }), 'direct-id');
  assert.equal(getVisibleProviderTaskId({ result: { providerTaskId: 'result-id' } }), 'result-id');
  assert.equal(getVisibleProviderTaskId({ id: 'internal-job-id' }), '');
});

test('shouldExposeActiveJobResult hides providerless KIE media jobs from project cards', () => {
  assert.equal(shouldExposeActiveJobResult({
    job: { provider: 'kie', taskType: 'kie_image' },
    module: 'one_click',
    payloadProjectId: 'project-a',
  }), false);
});

test('shouldExposeActiveJobResult keeps buyer-show providerless jobs visible when scoped to a project', () => {
  assert.equal(shouldExposeActiveJobResult({
    job: { provider: 'kie', taskType: 'kie_image' },
    module: 'buyer_show',
    payloadProjectId: 'buyer-show-project',
  }), true);
});

test('shouldExposeActiveJobResult exposes active media jobs once provider id is known', () => {
  assert.equal(shouldExposeActiveJobResult({
    job: { provider: 'kie', taskType: 'kie_image', providerTaskId: 'provider-task' },
    module: 'one_click',
    payloadProjectId: 'project-a',
  }), true);
});

test('buyer-show planning control jobs require an explicit shell project binding', () => {
  const job = {
    module: 'buyer_show',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: {
      taskPurpose: 'buyer_show_planning',
      shellPlanningPurpose: 'buyer_show_planning',
    },
  };

  assert.equal(isBuyerShowPlanningControlJob(job, 'buyer_show'), true);
  assert.equal(shouldExposeActiveJobResult({
    job,
    module: 'buyer_show',
  }), false);
  assert.equal(shouldExposeActiveJobResult({
    job,
    module: 'buyer_show',
    payloadProjectId: 'buyer-show-real-project',
  }), true);
});

test('isShellControlJob recognizes planning and analysis jobs across shell modules', () => {
  assert.equal(isShellControlJob({ module: 'retouch', taskType: 'kie_chat', payload: {} }, 'retouch'), true);
  assert.equal(isShellControlJob({ module: 'video', taskType: 'kie_chat', payload: {} }, 'video'), true);
  assert.equal(isShellControlJob({
    module: 'translation',
    taskType: 'kie_chat',
    payload: { taskPurpose: 'translation_copy_analysis' },
  }, 'translation'), true);
  assert.equal(isShellControlJob({
    module: 'one_click',
    taskType: 'kie_chat',
    payload: { shellPlanningPurpose: 'one_click_planning' },
  }, 'one_click'), true);
  assert.equal(isShellControlJob({
    module: 'everything_replace',
    taskType: 'kie_chat',
    payload: { taskPurpose: 'logo_replace_analysis' },
  }, 'everything_replace'), true);
  assert.equal(isShellControlJob({
    module: 'everything_replace',
    taskType: 'kie_chat',
    payload: { taskPurpose: 'logo_replace_quality_check' },
  }, 'everything_replace'), true);
  assert.equal(isShellControlJob({
    module: 'everything_replace',
    taskType: 'kie_chat',
    payload: { taskPurpose: 'product_replace_analysis' },
  }, 'everything_replace'), true);
  assert.equal(isShellControlJob({ module: 'retouch', taskType: 'kie_image', payload: {} }, 'retouch'), false);
});
