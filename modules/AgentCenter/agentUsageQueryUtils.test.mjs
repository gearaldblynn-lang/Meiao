import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentUsageFilterOptions, filterAgentUsageRows, paginateAgentUsageRows } from './agentUsageQueryUtils.mjs';

const rows = [
  { id: '1', userId: 'u1', displayName: '张三', username: 'zhangsan', selectedModel: 'model-a', status: 'success', createdAt: new Date('2026-04-04T10:00:00+08:00').getTime() },
  { id: '2', userId: 'u2', displayName: '李四', username: 'lisi', selectedModel: 'model-b', status: 'failed', createdAt: new Date('2026-04-03T10:00:00+08:00').getTime() },
  { id: '3', userId: 'u1', displayName: '张三', username: 'zhangsan', selectedModel: 'model-b', status: 'success', createdAt: new Date('2026-04-02T10:00:00+08:00').getTime() },
];

test('buildAgentUsageFilterOptions derives distinct users and models from usage rows', () => {
  const options = buildAgentUsageFilterOptions(rows);
  assert.deepEqual(options.users, [
    { id: 'u2', label: '李四' },
    { id: 'u1', label: '张三' },
  ]);
  assert.deepEqual(options.models, ['model-a', 'model-b']);
});

test('filterAgentUsageRows filters by user, model, status, and time range together', () => {
  const filtered = filterAgentUsageRows(rows, {
    userId: 'u1',
    model: 'model-b',
    status: 'success',
    startAt: new Date('2026-04-01T00:00:00+08:00').getTime(),
    endAt: new Date('2026-04-03T23:59:59+08:00').getTime(),
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '3');
});

test('paginateAgentUsageRows returns stable page slices and total counts', () => {
  const result = paginateAgentUsageRows(rows, { page: 2, pageSize: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 2);
  assert.deepEqual(result.rows.map((row) => row.id), ['3']);
});
