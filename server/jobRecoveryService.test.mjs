import test from 'node:test';
import assert from 'node:assert/strict';

import { findJobByProviderTaskIdForUser } from './jobManager.mjs';
import { findLocalJobByProviderTaskIdForUser } from './localJobStore.mjs';
import { createAuthorizedProviderRecovery } from './jobRecoveryService.mjs';

const createMysqlLookup = (jobs) => async (userId, providerTaskId) => {
  const pool = {
    query: async (_sql, values) => {
      const [scopedUserId, scopedProviderTaskId] = values;
      const row = jobs.find((job) => (
        job.user_id === scopedUserId
        && job.provider_task_id === scopedProviderTaskId
        && job.provider === 'kie'
        && ['kie_image', 'kie_video', 'kie_seedance_video', 'kie_veo'].includes(job.task_type)
      ));
      return [row ? [row] : []];
    },
  };
  return findJobByProviderTaskIdForUser(pool, userId, providerTaskId);
};

const createLocalStore = (jobs) => ({ jobs, users: [], sessions: [], logs: [], appStates: {} });

const baseRequest = {
  providerTaskId: 'provider-shared-1',
  provider: 'kie',
  taskType: 'kie_recover',
  payload: { isVideo: false },
};

const mysqlRow = (userId) => ({
  id: `source-${userId}`,
  user_id: userId,
  module: 'one_click',
  task_type: 'kie_image',
  provider: 'kie',
  status: 'succeeded',
  provider_task_id: 'provider-shared-1',
  payload_json: '{}',
  result_json: '{}',
  created_at: 1,
  updated_at: 1,
});

const localJob = (userId) => ({
  id: `source-${userId}`,
  userId,
  module: 'one_click',
  taskType: 'kie_image',
  provider: 'kie',
  status: 'succeeded',
  providerTaskId: 'provider-shared-1',
  payload: {},
  createdAt: 1,
  updatedAt: 1,
});

const assertRejectedWithoutCreation = async (findSourceJob) => {
  let createCalls = 0;
  const createRecoveryJob = async () => {
    createCalls += 1;
    return { id: 'must-not-exist' };
  };
  const reject = async (providerTaskId) => assert.rejects(
    () => createAuthorizedProviderRecovery({
      userId: 'user-a',
      request: { ...baseRequest, providerTaskId },
      findSourceJob,
      createRecoveryJob,
    }),
    (error) => error?.statusCode === 404
      && error?.code === 'job_recovery_source_not_found'
      && error?.message === '未找到可恢复的历史任务。',
  );

  await reject('provider-shared-1');
  await reject('provider-missing');
  assert.equal(createCalls, 0);
};

test('mysql recovery orchestration rejects cross-user and missing ids identically without creation', async () => {
  await assertRejectedWithoutCreation(createMysqlLookup([mysqlRow('user-b')]));
});

test('local recovery orchestration rejects cross-user and missing ids identically without creation', async () => {
  const store = createLocalStore([localJob('user-b')]);
  await assertRejectedWithoutCreation((userId, providerTaskId) => (
    findLocalJobByProviderTaskIdForUser(store, userId, providerTaskId)
  ));
});

test('mysql and local recovery orchestration create only after same-user authorization', async () => {
  const localStore = createLocalStore([localJob('user-a')]);
  const lookups = [
    createMysqlLookup([mysqlRow('user-a')]),
    (userId, providerTaskId) => findLocalJobByProviderTaskIdForUser(localStore, userId, providerTaskId),
  ];

  for (const findSourceJob of lookups) {
    let createCalls = 0;
    const result = await createAuthorizedProviderRecovery({
      userId: 'user-a',
      request: baseRequest,
      findSourceJob,
      createRecoveryJob: async (sourceJob) => {
        createCalls += 1;
        return { id: 'recovery-1', sourceJobId: sourceJob.id };
      },
    });
    assert.deepEqual(result, { id: 'recovery-1', sourceJobId: 'source-user-a' });
    assert.equal(createCalls, 1);
  }
});
