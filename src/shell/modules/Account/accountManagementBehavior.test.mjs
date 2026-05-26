import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AccountManagement.tsx', import.meta.url), 'utf8');

test('shell account management exports every filtered log page instead of one capped page', () => {
  assert.match(source, /const exportPageSize = 200/);
  assert.match(source, /const exportedLogs: InternalLogEntry\[\] = \[\]/);
  assert.match(source, /while \(exportedLogs\.length < totalToExport\)/);
  assert.match(source, /await fetchInternalLogs\(\{/);
  assert.doesNotMatch(source, /pageSize: Math\.max\(200, logsTotal\)/);
  assert.match(source, /setMessage\(`已导出 \$\{exportedLogs\.length\} 条日志`\)/);
});
