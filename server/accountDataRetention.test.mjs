import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('local runtime keeps the full 7 day log window instead of capping records', () => {
  const normalizeLogsBody = serverSource.match(/const normalizeLogs = \(logs\) => \{[\s\S]*?\n\};/)?.[0] || '';

  assert.match(normalizeLogsBody, /pruneLogsByRetention\(logs\)/);
  assert.doesNotMatch(normalizeLogsBody, /\.slice\(0,\s*500\)/);
});

test('manual log deletion endpoints are disabled and logs expire by 7 day retention automation', () => {
  assert.match(serverSource, /运行日志仅按 7 天保留策略自动清理，禁止手动清理。/);
  assert.match(serverSource, /const LOG_RETENTION_MS = 1000 \* 60 \* 60 \* 24 \* 7/);
  assert.match(serverSource, /const LOG_CLEANUP_INTERVAL_MS = 1000 \* 60 \* 60/);
  assert.match(serverSource, /DELETE FROM internal_logs WHERE created_at < \?/);
  assert.match(serverSource, /logCleanupTimer = setInterval/);
  assert.match(serverSource, /cleanupExpiredLogs/);
});

test('stats backfill recomputes only log-covered dates and preserves older permanent stats', () => {
  assert.doesNotMatch(serverSource, /DELETE FROM usage_daily WHERE 1=1/);
  assert.match(serverSource, /const recomputeDates = Array\.from\(new Set\(logRows\.map/);
  assert.match(serverSource, /WHERE stat_date IN \(\$\{datePlaceholders\}\)/);
  assert.match(serverSource, /const recomputeRows = Object\.values\(logsByKey\)/);
  assert.match(serverSource, /\.\.\.\(store\.usageDaily \|\| \[\]\)\.filter/);
});

test('account delete API hard deletes account data while preserving permanent usage stats', () => {
  const deleteDbUserBody = serverSource.match(/const deleteDbUser = async \(userId\) => \{[\s\S]*?\n\};/)?.[0] || '';
  const deleteRouteBody = serverSource.match(/if \(userDetailMatch && req\.method === 'DELETE'\) \{[\s\S]*?json\(res, 200, \{ ok: true \}\);/)?.[0] || '';

  assert.match(deleteDbUserBody, /DELETE FROM sessions WHERE user_id = \?/);
  assert.match(deleteDbUserBody, /DELETE FROM app_states WHERE user_id = \?/);
  assert.match(deleteDbUserBody, /DELETE FROM internal_logs WHERE user_id = \?/);
  assert.match(deleteDbUserBody, /DELETE FROM internal_jobs WHERE user_id = \?/);
  assert.match(deleteDbUserBody, /DELETE FROM stored_assets WHERE user_id = \?/);
  assert.match(deleteDbUserBody, /DELETE FROM users WHERE id = \?/);
  assert.doesNotMatch(deleteDbUserBody, /DELETE FROM usage_daily/);
  assert.match(serverSource, /usageStatsPreserved: true/);
  assert.match(serverSource, /delete store\.appStates\[targetUser\.id\]/);
  assert.doesNotMatch(serverSource, /targetUser\.status = 'disabled'/);
  assert.match(serverSource, /const findAnyDbUserById = async \(userId\)/);
  assert.match(deleteRouteBody, /findAnyDbUserById\(targetUserId\)/);
  assert.doesNotMatch(deleteRouteBody, /findDbUserById\(targetUserId\)/);
});
