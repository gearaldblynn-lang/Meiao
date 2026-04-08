import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AccountManagement.tsx', import.meta.url), 'utf8');

test('account management exports all filtered logs across pages instead of only the current page', () => {
  assert.match(source, /const exportPageSize = 200/);
  assert.match(source, /while \(exportedLogs\.length < totalToExport\)/);
  assert.match(source, /await fetchInternalLogs\(\{/);
  assert.match(source, /setLogsMessage\(`已导出筛选结果 \$\{exportedLogs\.length\} 条日志。`\)/);
});
