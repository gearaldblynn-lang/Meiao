import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLogFilterOptions, normalizeLogPagination } from './logQueryUtils.mjs';

test('normalizeLogPagination defaults safely and caps oversized page sizes', () => {
  assert.deepEqual(normalizeLogPagination({}), { page: 1, pageSize: 50, offset: 0 });
  assert.deepEqual(normalizeLogPagination({ page: '3', pageSize: '500' }), { page: 3, pageSize: 200, offset: 400 });
});

test('buildLogFilterOptions derives distinct modules and users from full log history', () => {
  const options = buildLogFilterOptions([
    { module: 'one_click', userId: 'u-2', username: 'zhangsan', displayName: '张三' },
    { module: 'translation', userId: 'u-1', username: 'lisi', displayName: '李四' },
    { module: 'one_click', userId: 'u-1', username: 'lisi', displayName: '李四' },
  ]);

  assert.deepEqual(options.modules, ['one_click', 'translation']);
  assert.deepEqual(options.users, [
    { id: 'u-1', label: '李四' },
    { id: 'u-2', label: '张三' },
  ]);
});
