import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
const localJobStoreSource = readFileSync(new URL('./localJobStore.mjs', import.meta.url), 'utf8');
const jobRuntimeSource = readFileSync(new URL('./jobRuntime.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('failed job logs keep providerTaskId from the thrown provider error', () => {
  assert.match(jobManagerSource, /buildJobRuntimeLogMeta\(\{ job: latestJob, error, finishedAt, retryCount: failure\.retryCount \}\)/);
  assert.match(localJobStoreSource, /buildJobRuntimeLogMeta\(\{ job: failedJob, error, finishedAt: failedJob\.finishedAt \|\| Date\.now\(\), retryCount: failedJob\.retryCount \}\)/);
  assert.match(jobRuntimeSource, /providerTaskId,\s*\n\s*provider:/);
  assert.match(jobRuntimeSource, /error\?\.providerTaskId/);
});

test('successful job logs include provider credits for billing statistics', () => {
  assert.match(jobManagerSource, /buildJobRuntimeLogMeta\(\{ job: refreshedJob, result: output, finishedAt \}\)/);
  assert.match(localJobStoreSource, /buildJobRuntimeLogMeta\(\{ job: finishedJob, result: \{ providerTaskId: finishedJob\.providerTaskId, result: finishedJob\.result \}, finishedAt: finishedJob\.finishedAt \}\)/);
  assert.match(jobRuntimeSource, /creditsConsumed = normalizeLogCreditsConsumed/);
  assert.match(jobRuntimeSource, /creditsConsumed !== undefined \? \{ creditsConsumed \} : \{\}/);
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

test('video jobs force zero automatic retries at the server entry points', () => {
  assert.match(serverSource, /const normalizeJobMaxRetries = \(taskType, value\) => \(/);
  assert.match(serverSource, /VIDEO_JOB_TASK_TYPES\.has\(String\(taskType \|\| ''\)\) \? 0 : value/);
  const maxRetryAssignments = serverSource.match(/maxRetries: normalizeJobMaxRetries\(body\.taskType, body\.maxRetries\)/g) || [];
  assert.equal(maxRetryAssignments.length, 2);
});
