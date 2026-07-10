import test from 'node:test';
import assert from 'node:assert/strict';

import { checkDeployReadiness, summarizeRunningJobs } from './check-deploy-readiness.mjs';

test('summarizeRunningJobs separates providerless and submitted work without exposing users', () => {
  const summary = summarizeRunningJobs([
    { task_type: 'kie_chat', provider: 'kie', provider_task_id: '', started_at: 3000 },
    { task_type: 'kie_image', provider: 'kie', provider_task_id: 'task-1', started_at: 2000 },
    { task_type: 'kie_image', provider: 'kie', provider_task_id: 'task-2', started_at: 4000 },
  ]);

  assert.deepEqual(summary, {
    runningCount: 3,
    providerlessCount: 1,
    submittedCount: 2,
    oldestStartedAt: 2000,
    byTaskType: { kie_chat: 1, kie_image: 2 },
    byProvider: { kie: 3 },
  });
  assert.equal(JSON.stringify(summary).includes('task-1'), false);
});

test('summarizeRunningJobs reports an empty deployment window', () => {
  assert.deepEqual(summarizeRunningJobs([]), {
    runningCount: 0,
    providerlessCount: 0,
    submittedCount: 0,
    oldestStartedAt: 0,
    byTaskType: {},
    byProvider: {},
  });
});

test('checkDeployReadiness fails closed on running jobs unless explicitly overridden', async () => {
  let closed = false;
  const createConnection = async () => ({
    query: async () => [[{ task_type: 'kie_chat', provider: 'kie', provider_task_id: '', started_at: 1000 }]],
    end: async () => { closed = true; },
  });

  const blocked = await checkDeployReadiness({ env: {}, createConnection });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.override, false);
  assert.equal(closed, true);

  const forced = await checkDeployReadiness({
    env: { MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS: '1' },
    createConnection,
  });
  assert.equal(forced.ready, true);
  assert.equal(forced.override, true);
});
