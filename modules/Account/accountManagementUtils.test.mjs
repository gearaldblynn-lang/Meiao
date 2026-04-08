import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLogCsv, filterLogs, getEffectiveConcurrency, shouldRefreshCurrentUser } from './accountManagementUtils.mjs';

const createLog = (overrides = {}) => ({
  id: 'log-1',
  createdAt: 1710000000000,
  level: 'info',
  module: 'translation',
  action: 'process_single',
  message: '处理成功',
  detail: '',
  status: 'success',
  userId: 'user-1',
  username: 'tester',
  displayName: '测试员',
  meta: { jobId: 'job-1' },
  ...overrides,
});

test('getEffectiveConcurrency returns the single usable concurrency value', () => {
  assert.equal(getEffectiveConcurrency(8, 5), 5);
  assert.equal(getEffectiveConcurrency(3, 20), 20);
  assert.equal(getEffectiveConcurrency(3, 0), 3);
  assert.equal(getEffectiveConcurrency(0, 0), 5);
});

test('filterLogs applies module user and status filters together', () => {
  const logs = [
    createLog(),
    createLog({ id: 'log-2', module: 'retouch', userId: 'user-2', username: 'retoucher', displayName: '精修员', status: 'failed' }),
  ];

  const filtered = filterLogs(logs, {
    module: 'retouch',
    userId: 'user-2',
    status: 'failed',
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'log-2');
});

test('filterLogs applies createdAt range filters', () => {
  const logs = [
    createLog({ id: 'log-1', createdAt: 1710000000000 }),
    createLog({ id: 'log-2', createdAt: 1710086400000 }),
    createLog({ id: 'log-3', createdAt: 1710172800000 }),
  ];

  const filtered = filterLogs(logs, {
    startAt: 1710080000000,
    endAt: 1710120000000,
  });

  assert.deepEqual(filtered.map((log) => log.id), ['log-2']);
});

test('buildLogCsv exports visible log fields', () => {
  const csv = buildLogCsv([
    createLog({
      module: 'translation',
      message: '处理成功',
      status: 'success',
      detail: 'provider ok',
      meta: {
        jobId: 'job-1',
        providerTaskId: 'task-9',
        provider: 'kie',
        retryCount: 1,
        errorCode: '',
        fileName: '1.png',
        relativePath: '主图/1.png',
        uploadMethod: 'stream',
        queueWaitMs: 1200,
        runtimeMs: 5600,
      },
    }),
  ]);

  assert.match(csv, /内部任务ID/);
  assert.match(csv, /外部任务ID/);
  assert.match(csv, /主图\/1\.png/);
  assert.match(csv, /stream/);
  assert.match(csv, /5600/);
  assert.match(csv, /translation/);
  assert.match(csv, /处理成功/);
  assert.match(csv, /provider ok/);
});

test('shouldRefreshCurrentUser returns true only for current user updates', () => {
  assert.equal(shouldRefreshCurrentUser('user-1', 'user-1'), true);
  assert.equal(shouldRefreshCurrentUser('user-1', 'user-2'), false);
  assert.equal(shouldRefreshCurrentUser('', 'user-2'), false);
});

test('buildLogCsv can export multiple filtered pages together instead of only the visible page', () => {
  const csv = buildLogCsv([
    createLog({ id: 'log-1', message: '第一页' }),
    createLog({ id: 'log-2', message: '第二页', createdAt: 1710000001000 }),
    createLog({ id: 'log-3', message: '第三页', createdAt: 1710000002000 }),
  ]);

  assert.match(csv, /第一页/);
  assert.match(csv, /第二页/);
  assert.match(csv, /第三页/);
});
