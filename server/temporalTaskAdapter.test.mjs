import test from 'node:test';
import assert from 'node:assert/strict';

import { createTemporalTaskAdapter } from './temporalTaskAdapter.mjs';

test('temporal adapter reports disabled health without requiring the SDK', async () => {
  const adapter = createTemporalTaskAdapter({ env: {} });

  const health = await adapter.health();

  assert.equal(health.configured, false);
  assert.equal(health.reachable, false);
});

test('temporal adapter starts a workflow with stable id and explicit execution mode', async () => {
  const started = [];
  const adapter = createTemporalTaskAdapter({
    env: {
      MEIAO_TEMPORAL_ADDRESS: '127.0.0.1:7233',
      MEIAO_TEMPORAL_NAMESPACE: 'default',
      MEIAO_TEMPORAL_TASK_QUEUE: 'meiao-local',
    },
    connectTemporalClient: async () => ({
      workflow: {
        start: async (workflowType, options) => {
          started.push({ workflowType, options });
          return { workflowId: options.workflowId, firstExecutionRunId: 'run-1' };
        },
      },
      workflowService: {
        getSystemInfo: async () => ({}),
      },
    }),
  });

  const result = await adapter.startJobWorkflow({
    id: 'job-1',
    userId: 'user-1',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
  }, { executionMode: 'execute', ledger: 'mysql' });

  assert.equal(result.started, true);
  assert.equal(result.workflowId, 'meiao-job-job-1');
  assert.equal(result.runId, 'run-1');
  assert.equal(started[0].workflowType, 'meiaoTaskWorkflow');
  assert.equal(started[0].options.taskQueue, 'meiao-local');
  assert.deepEqual(started[0].options.args[0].jobId, 'job-1');
  assert.equal(started[0].options.args[0].executionMode, 'execute');
  assert.equal(started[0].options.args[0].ledger, 'mysql');
});

test('temporal adapter treats an already running workflow as recoverable', async () => {
  const adapter = createTemporalTaskAdapter({
    env: {
      MEIAO_TEMPORAL_ADDRESS: '127.0.0.1:7233',
      MEIAO_TEMPORAL_NAMESPACE: 'default',
      MEIAO_TEMPORAL_TASK_QUEUE: 'meiao-local',
    },
    connectTemporalClient: async () => ({
      workflow: {
        start: async () => {
          const error = new Error('WorkflowExecutionAlreadyStarted: workflow already started');
          error.name = 'WorkflowExecutionAlreadyStartedError';
          throw error;
        },
      },
    }),
  });

  const result = await adapter.startJobWorkflow({
    id: 'job-1',
    userId: 'user-1',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  }, { executionMode: 'execute', ledger: 'mysql' });

  assert.equal(result.started, false);
  assert.equal(result.workflowId, 'meiao-job-job-1');
  assert.equal(result.code, 'temporal_workflow_already_started');
});
