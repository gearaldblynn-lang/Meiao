import test from 'node:test';
import assert from 'node:assert/strict';

import { checkTemporalWorkerHealth } from './workerHealth.mjs';

const TASK_QUEUE_TYPE_WORKFLOW = 1;
const TASK_QUEUE_TYPE_ACTIVITY = 2;

const buildFakeDescribeTaskQueue = (pollersByType, options = {}) => {
  const calls = [];
  const describeTaskQueue = async (request) => {
    calls.push(request);
    if (options.error) {
      throw options.error;
    }
    return { pollers: pollersByType[request.taskQueueType] || [] };
  };
  return { describeTaskQueue, calls };
};

test('workflow poller 存在时返回 healthy:true 并带计数与 checkedAt', async () => {
  const { describeTaskQueue, calls } = buildFakeDescribeTaskQueue({
    [TASK_QUEUE_TYPE_WORKFLOW]: [{ identity: 'worker-a' }],
    [TASK_QUEUE_TYPE_ACTIVITY]: [{ identity: 'worker-a' }, { identity: 'worker-b' }],
  });

  const result = await checkTemporalWorkerHealth({
    describeTaskQueue,
    namespace: 'default',
    taskQueue: 'meiao-local',
    now: () => 1751700000000,
    cache: {},
  });

  assert.equal(result.healthy, true);
  assert.equal(result.workflowPollers, 1);
  assert.equal(result.activityPollers, 2);
  assert.equal(result.checkedAt, 1751700000000);

  assert.equal(calls.length, 2);
  const workflowCall = calls.find((call) => call.taskQueueType === TASK_QUEUE_TYPE_WORKFLOW);
  const activityCall = calls.find((call) => call.taskQueueType === TASK_QUEUE_TYPE_ACTIVITY);
  assert.ok(workflowCall, '应查询 WORKFLOW 类型 task queue');
  assert.ok(activityCall, '应查询 ACTIVITY 类型 task queue');
  assert.equal(workflowCall.namespace, 'default');
  assert.equal(workflowCall.taskQueue.name, 'meiao-local');
});

test('仅 activity poller 存在时也算 healthy:true', async () => {
  const { describeTaskQueue } = buildFakeDescribeTaskQueue({
    [TASK_QUEUE_TYPE_ACTIVITY]: [{ identity: 'worker-a' }],
  });

  const result = await checkTemporalWorkerHealth({
    describeTaskQueue,
    now: () => 1751700000000,
    cache: {},
  });

  assert.equal(result.healthy, true);
  assert.equal(result.workflowPollers, 0);
  assert.equal(result.activityPollers, 1);
});

test('workflow 和 activity 都无 poller 时返回 healthy:false 且计数为 0', async () => {
  const { describeTaskQueue } = buildFakeDescribeTaskQueue({});

  const result = await checkTemporalWorkerHealth({
    describeTaskQueue,
    now: () => 1751700000000,
    cache: {},
  });

  assert.equal(result.healthy, false);
  assert.equal(result.workflowPollers, 0);
  assert.equal(result.activityPollers, 0);
});

test('describeTaskQueue 抛错时函数不抛,降级为 healthy:false + error 文本', async () => {
  const { describeTaskQueue } = buildFakeDescribeTaskQueue({}, {
    error: new Error('14 UNAVAILABLE: No connection established'),
  });

  const result = await checkTemporalWorkerHealth({
    describeTaskQueue,
    now: () => 1751700000000,
    cache: {},
  });

  assert.equal(result.healthy, false);
  assert.equal(result.error, '14 UNAVAILABLE: No connection established');
});

test('同一 cache 实例 10s 内第二次调用不再打 describeTaskQueue', async () => {
  const { describeTaskQueue, calls } = buildFakeDescribeTaskQueue({
    [TASK_QUEUE_TYPE_WORKFLOW]: [{ identity: 'worker-a' }],
  });

  const cache = {};
  let currentTime = 1751700000000;
  const deps = {
    describeTaskQueue,
    now: () => currentTime,
    cache,
  };

  const first = await checkTemporalWorkerHealth(deps);
  assert.equal(calls.length, 2, '首次调用应打 2 次 describeTaskQueue');

  currentTime += 5000;
  const second = await checkTemporalWorkerHealth(deps);
  assert.equal(calls.length, 2, '10s 内第二次调用不应再打 describeTaskQueue');
  assert.deepEqual(second, first, '缓存命中时应返回同一份结果');
});

test('超过缓存 TTL 后再次调用会重新打 describeTaskQueue', async () => {
  const { describeTaskQueue, calls } = buildFakeDescribeTaskQueue({
    [TASK_QUEUE_TYPE_WORKFLOW]: [{ identity: 'worker-a' }],
  });

  const cache = {};
  let currentTime = 1751700000000;
  const deps = {
    describeTaskQueue,
    now: () => currentTime,
    cache,
    cacheTtlMs: 10000,
  };

  await checkTemporalWorkerHealth(deps);
  currentTime += 10001;
  const refreshed = await checkTemporalWorkerHealth(deps);

  assert.equal(calls.length, 4, 'TTL 过期后应重新打 2 次 describeTaskQueue');
  assert.equal(refreshed.checkedAt, currentTime);
});
