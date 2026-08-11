import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTerminalKieJobResult } from './kieJobResult.mjs';

test('terminal KIE result maps a succeeded job found after the frontend timeout', () => {
  const result = resolveTerminalKieJobResult({
    id: 'fe0e3ba1d15d3532d19acf73',
    taskType: 'kie_image',
    status: 'succeeded',
    providerTaskId: '35774d0f8c54f35f4629bd9453eb3c6f',
    result: {
      imageUrl: 'https://assets.example.test/storyboard-2.jpg',
      creditsConsumed: 3,
    },
  });

  assert.deepEqual(result, {
    imageUrl: 'https://assets.example.test/storyboard-2.jpg',
    videoUrl: undefined,
    taskId: '35774d0f8c54f35f4629bd9453eb3c6f',
    backendJobId: 'fe0e3ba1d15d3532d19acf73',
    status: 'success',
    message: '',
    creditsConsumed: 3,
  });
});

test('terminal KIE result leaves non-terminal jobs unresolved', () => {
  assert.equal(resolveTerminalKieJobResult({
    id: 'running-job',
    status: 'running',
    providerTaskId: 'provider-running',
  }), null);
});

test('terminal KIE result preserves failed, cancelled and missing-task states', () => {
  assert.deepEqual(resolveTerminalKieJobResult({
    id: 'failed-job',
    status: 'failed',
    providerTaskId: 'provider-failed',
    errorCode: 'provider_bad_request',
    errorMessage: '参数错误',
  }), {
    imageUrl: '',
    taskId: 'provider-failed',
    backendJobId: 'failed-job',
    status: 'error',
    message: '参数错误',
    errorCode: 'provider_bad_request',
  });
  assert.equal(resolveTerminalKieJobResult({ status: 'cancelled' })?.status, 'interrupted');
  assert.equal(resolveTerminalKieJobResult({ status: 'failed', errorCode: 'task_not_found' })?.status, 'task_not_found');
});
