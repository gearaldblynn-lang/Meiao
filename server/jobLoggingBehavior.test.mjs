import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
const localJobStoreSource = readFileSync(new URL('./localJobStore.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('failed job logs keep providerTaskId from the thrown provider error', () => {
  assert.match(jobManagerSource, /providerTaskId: error\?\.providerTaskId \|\| latestJob\.providerTaskId \|\| ''/);
  assert.match(localJobStoreSource, /providerTaskId: error\?\.providerTaskId \|\| failedJob\.providerTaskId \|\| ''/);
});

test('successful job logs include provider credits for billing statistics', () => {
  assert.match(jobManagerSource, /creditsConsumed: normalizeJobCreditsConsumed\(output\?\.result\?\.creditsConsumed \?\? output\?\.creditsConsumed\)/);
  assert.match(localJobStoreSource, /creditsConsumed: normalizeJobCreditsConsumed\(finishedJob\.result\?\.creditsConsumed\)/);
});

test('usage statistics persist successful actual credits per account', () => {
  assert.match(serverSource, /credits_consumed DECIMAL\(12,2\) DEFAULT 0/);
  assert.match(serverSource, /ensureMysqlColumn\(pool, 'usage_daily', 'credits_consumed', 'DECIMAL\(12,2\) DEFAULT 0'\)/);
  assert.match(serverSource, /'analysis_token_usage'/);
  assert.match(serverSource, /credits_consumed = credits_consumed \+ VALUES\(credits_consumed\)/);
  assert.match(serverSource, /creditsConsumed: Number\(r\.credits_consumed \|\| 0\)/);
  assert.match(serverSource, /row\.creditsConsumed = Number\(row\.creditsConsumed \|\| 0\) \+ extractUsageCreditsConsumed\(log\)/);
});

test('usage statistics cover billed xhs cover and video job completions', () => {
  assert.match(serverSource, /const USAGE_MODULES = new Set\(\['agent_center', 'one_click', 'translation', 'buyer_show', 'retouch', 'video', 'xhs_cover'\]\)/);
  assert.match(serverSource, /const USAGE_JOB_COMPLETED_TASK_TYPES = new Set\(\['dreamina_video', 'kie_seedance_video', 'kie_video', 'kie_veo'\]\)/);
  assert.match(serverSource, /const shouldTrackUsageStatLog = \(log = \{\}\) =>/);
  assert.match(serverSource, /log\.action === 'job_completed'/);
  assert.match(serverSource, /JSON_UNQUOTE\(JSON_EXTRACT\(meta_json, '\$\.taskType'\)\) IN \('dreamina_video','kie_seedance_video','kie_video','kie_veo'\)/);
});

test('usage statistics can be viewed by staff in their own account scope', () => {
  assert.match(serverSource, /const viewer = await requireDbUser\(req, res\)/);
  assert.match(serverSource, /const requestedUserId = normalizeLogFilterValue\(url\.searchParams\.get\('userId'\)\)/);
  assert.match(serverSource, /const userId = viewer\.role === 'admin' \? requestedUserId : viewer\.id/);
  assert.match(serverSource, /const viewer = localRequireUser\(req, res, store\)/);
});
