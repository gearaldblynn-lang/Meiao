import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getVisibleProviderTaskId,
  isProviderMediaJob,
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
