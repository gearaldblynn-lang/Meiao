import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPersistedTerminalJobResult } from './shellTerminalJobMerge.ts';

test('hasPersistedTerminalJobResult matches a persisted result by backend job id', () => {
  assert.equal(hasPersistedTerminalJobResult({
    results: [{
      backendJobId: 'job-finished-1',
      taskId: 'provider-finished-1',
      imageUrl: '/finished.png',
      status: 'completed',
    }],
    jobId: 'job-finished-1',
    providerTaskId: 'provider-finished-1',
    payloadPlanId: 'plan-1',
  }), true);
});

test('hasPersistedTerminalJobResult matches a persisted terminal error by provider task id', () => {
  assert.equal(hasPersistedTerminalJobResult({
    results: [{
      id: 'provider-failed-1',
      taskId: 'provider-failed-1',
      imageUrl: '',
      status: 'error',
    }],
    jobId: 'job-failed-1',
    providerTaskId: 'provider-failed-1',
    payloadPlanId: 'plan-1',
  }), true);
});

test('hasPersistedTerminalJobResult lets incoming media replace a stale no-media error with same job id', () => {
  assert.equal(hasPersistedTerminalJobResult({
    results: [{
      backendJobId: 'job-late-success',
      taskId: 'provider-late-success',
      imageUrl: '',
      status: 'error',
      error: '任务等待超时，请稍后在任务列表中查看结果',
    }],
    jobId: 'job-late-success',
    providerTaskId: 'provider-late-success',
    payloadPlanId: 'plan-1',
    incomingHasMedia: true,
  }), false);
});

test('hasPersistedTerminalJobResult does not treat same-plan stale failures as the same concrete retry job', () => {
  assert.equal(hasPersistedTerminalJobResult({
    results: [{
      backendJobId: 'old-job-failed',
      taskId: 'old-provider-failed',
      planId: 'plan-1',
      imageUrl: '',
      status: 'error',
    }],
    jobId: 'new-job-success',
    providerTaskId: 'new-provider-success',
    payloadPlanId: 'plan-1',
  }), false);
});

test('hasPersistedTerminalJobResult falls back to same-plan terminal result only when the incoming job has no concrete identity', () => {
  assert.equal(hasPersistedTerminalJobResult({
    results: [{
      planId: 'plan-1',
      imageUrl: '/finished-without-task.png',
      status: 'completed',
    }],
    payloadPlanId: 'plan-1',
  }), true);

  assert.equal(hasPersistedTerminalJobResult({
    results: [{
      planId: 'plan-1',
      imageUrl: '',
      status: 'generating',
    }],
    payloadPlanId: 'plan-1',
  }), false);
});
