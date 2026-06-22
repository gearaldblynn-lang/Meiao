import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOneClickJobCreatedPatch,
  buildOneClickRunStartPatch,
} from './oneClickGenerationRun.mjs';

test('one click run start clears stale identity only for new generation', () => {
  assert.deepEqual(buildOneClickRunStartPatch('full'), {
    status: 'generating',
    error: undefined,
    taskId: undefined,
    resultUrl: undefined,
  });
});

test('one click run start preserves identity for recovery', () => {
  assert.deepEqual(buildOneClickRunStartPatch('recover'), {
    status: 'generating',
    error: undefined,
  });
});

test('one click job-created patch exposes backend job id without faking visible task id', () => {
  assert.deepEqual(buildOneClickJobCreatedPatch('backend-job-1', ''), {
    backendJobId: 'backend-job-1',
    taskId: undefined,
    error: '任务正在提交云端...',
  });
});

test('one click job-created patch exposes provider task id as visible task id', () => {
  assert.deepEqual(buildOneClickJobCreatedPatch('backend-job-1', 'provider-task-1'), {
    backendJobId: 'backend-job-1',
    taskId: 'provider-task-1',
    error: '任务已提交云端，正在生成...',
  });
});
